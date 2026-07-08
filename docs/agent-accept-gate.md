# How the Agent Accept-Gate Problem Was Solved

A high-level write-up of "the gate problem" — when to actually connect the caller to a
human agent — and how the middleware solves it. Includes the core code.

---

## The problem

The agent is reached through an **ACD / queue (Webex Contact Center)**. When the
middleware places the outbound call to the agent, **Webex auto-answers it immediately**
to put it in a queue — *before a human is on the line.*

Naively, the middleware treated "the agent call was answered" as "the agent is ready,"
so it bridged the two callers instantly. That's wrong: the caller got connected to an
empty queue (Webex hold music / IVR), translation started against nobody, and the caller
heard repeated *"please wait while we configure…"* filler.

So we needed a **gate**: hold the caller on our own music and **don't bridge until a real
human agent signals they're ready.** Two sub-questions:

1. **What signals "a human is ready"?** (The call being answered no longer means this.)
2. **Which of the many in-flight sessions does that signal belong to?** (There can be
   hundreds at once.)

---

## The key insight

Use a signal that is **in-band on the agent's own call leg** — specifically, the agent
**pressing a key (DTMF)**. Two things fall out of this for free:

- It only happens when a **human** is actually there to press it.
- The keypress arrives **on that specific call's WebSocket connection**, which the
  middleware *already linked to its caller* when it dialed. So it's **self-correlating** —
  no phone-number matching, no lookup, correct even with hundreds of simultaneous calls.

This sidesteps the whole "which session?" correlation problem for *accepting* a call.

---

## The solution flow

```
Agent call auto-answered by the queue
        │
        ▼
Middleware: DON'T bridge. Mark the leg "awaiting accept".
        │   keep the caller on hold music 🎵
        │   whisper to the agent: "Incoming call from <number>. Press 1 to connect."  (repeats)
        ▼
Human agent finally takes the call and presses 1
        │   (DTMF arrives ON this leg → already linked to its caller)
        ▼
Middleware: bridgeLegs() → stop music, start translation, mark session activated
```

If no one presses 1 within a timeout (45s), the caller hears an apology and both legs
are ended.

---

## The code

> The gate logic lives in `local-server/accept-gate.mjs` (a `createAcceptGate({…})`
> factory wired with its side-effecting dependencies in `local-server/server.mjs`),
> extracted so it can be unit-tested with injected fakes — see
> `local-server/accept-gate.test.mjs`. The snippets below are illustrative.

### 1. The gate — don't bridge on answer; wait for the keypress

In the agent-leg (`callee`) setup handler:

```js
if (party.whichParty === 'callee') {
  const caller = connections.get(party.targetConnectionId);
  if (!caller) { /* … error … */ return; }

  // With an ACD/queue that auto-answers before a human is present, don't bridge on
  // "answered" — wait for the human to press the accept key. Caller stays on hold music.
  if (process.env.AGENT_ACCEPT_DTMF === 'true') {
    party.awaitingAccept = true;
    log('agent leg connected — awaiting DTMF accept', { connectionId, callerId: caller.pk });
    await startAgentWhisper(party);          // repeats "press 1 to connect" + the caller's number
    return;                                  // ← the gate: stop here, no bridge yet
  }

  bridgeLegs(party, caller);                 // (no gate: bridge immediately, e.g. direct-dial agent)
}
```

### 2. The accept signal — `handleDtmf` (self-correlating)

```js
function handleDtmf(connectionId, body) {
  const party = connections.get(connectionId);   // ← the leg the keypress arrived on
  if (!party) return;
  const digit = String(body.digit ?? body.digits ?? '');
  if (!party.awaitingAccept) return;              // ignore keys unless this leg is waiting
  if (digit !== (process.env.AGENT_ACCEPT_DIGIT || '1')) return;

  const caller = connections.get(party.targetConnectionId);  // ← its linked caller (set at dial time)
  if (!caller) { /* … error … */ return; }
  log('agent accepted call', { connectionId, callerId: caller.pk });
  bridgeLegs(party, caller);                       // connect THIS agent to THIS caller
}
```

The leg is linked to its caller back when the agent was dialed (the outbound call is
stamped with `targetConnectionId = caller.pk`). So `connectionId → party →
party.targetConnectionId → caller` is a direct chain — never a guess.

### 3. Connecting them — `bridgeLegs`

```js
function bridgeLegs(agentParty, caller) {
  caller.translationActive = true;
  caller.onHold = false;
  caller.targetConnectionId = agentParty.pk;
  // … copy the agent's language/voice onto the caller leg for translation …

  agentParty.translationActive = true;
  agentParty.awaitingAccept = false;
  agentParty.targetConnectionId = caller.pk;

  clearHoldMusic(caller);                 // stop the music
  clearAgentWhisper(agentParty);          // stop the "press 1" prompt
  sessions.activate(caller.From, { … });  // mark the session activated (correct number)
  sendWs(caller.ws,    { type: 'text', token: 'The translation session has begun.', last: true });
  sendWs(agentParty.ws,{ type: 'text', token: 'The translation session has begun.', last: true });
}
```

### 4. The whisper — repeats so a late-arriving human hears it

Because the human joins the *queued* call late, the prompt repeats, and it announces the
caller's number (read digit-by-digit) so the agent knows who's calling:

```js
async function startAgentWhisper(agentParty) {
  const digit  = process.env.AGENT_ACCEPT_DIGIT || '1';
  const number = spokenPhone(agentParty.callerPhone);   // "6 1 9, 5 7 6, 4 7 4 4"
  const text = number
    ? `${await localize('Incoming translated call from')} ${number}. ${await localize(`Press ${digit} to connect.`)}`
    : `${await localize('You have a translated call waiting.')} ${await localize(`Press ${digit} to connect.`)}`;
  const whisper = () => {
    if (!agentParty.awaitingAccept) return;             // stop once accepted/gone
    sendWs(agentParty.ws, { type: 'text', token: text, last: true });
    agentParty.whisperTimer = setTimeout(whisper, repeatMs);   // from AGENT_ACCEPT_REPEAT_MS (default 15000)
  };
  whisper();
}
```

### 5. Optional HTTP accept (same bridge, different trigger)

For setups where the flow signals readiness over HTTP instead of a keypress:

```js
// POST /v1/call-answered?callerAni=+16195764744
//   → finds the awaiting agent leg for that caller and calls bridgeLegs()
//   (with no number, it bridges the single waiting call; 409 if several are waiting)
```

> Caveat: the HTTP trigger needs a key (`callerAni`) to identify the session, which the
> agent-side flow doesn't have over PSTN. The **keypress** needs no key — that's why it's
> the reliable path.

---

## Why it's reliable at any scale

Every call session is a **pair of private WebSocket connections** (caller + agent),
linked at dial time. A keypress on agent-leg `#ccc` can only mean caller `#ccc` — even
with 100 calls landing at once, two keypresses arrive on two different connections and
flip two different sessions. **No collisions, no ordering assumptions, no lookups.**

(Contrast: an *out-of-band* HTTP "someone answered" has nothing tying it to a specific
session, so it needs a correlation key — which is the hard part over PSTN.)

---

## Config

| Env var | Default | Meaning |
|---------|---------|---------|
| `AGENT_ACCEPT_DTMF` | `false` | Turn the gate on (for ACD/queue endpoints like Webex) |
| `AGENT_ACCEPT_DIGIT` | `1` | The key the agent presses to accept |
| `AGENT_ACCEPT_REPEAT_MS` | `15000` | How often to repeat the "press 1" whisper |
| `HOLD_TIMEOUT_MS` | `45000` | No-answer timeout → apologize + hang up |

Enabling the gate also flips `dtmfDetection: "true"` on the agent leg's ConversationRelay
TwiML so Twilio sends us the `dtmf` messages.

---

## Verified

On a live call: the agent pressed **1**, Webex passed the keypress through, and the log
showed the keypress arriving on the agent leg and bridging it straight back to the correct
caller:

```
dtmf { connectionId: 'f8369ef1…', whichParty: 'callee', digit: '1' }
agent accepted call { connectionId: 'f8369ef1…', callerId: '216b60d4…' }
```
