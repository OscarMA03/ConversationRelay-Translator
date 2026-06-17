# Hold music while waiting for the agent to pick up — design

**Date:** 2026-06-17
**Status:** Approved design, ready to plan/implement
**Author:** Oscar (with Claude Code, via the brainstorming workflow)

---

## TL;DR (read this to your teammate first)

Today, when someone calls in, we immediately dial the agent and the caller hears
**silence** while the agent's phone rings. This change fills that gap with **hold
music**, plus **one spoken reassurance line** (~10 seconds in, in the caller's own
language). The music **stops by itself** when the agent answers. If nobody answers
within **45 seconds**, the caller hears a short apology and the call hangs up.

It's a small, self-contained change:
- **One new file** — `local-server/hold-music.mjs` (the music/line/timeout logic).
- **Three small edits** in `local-server/server.mjs` (start music, stop on pickup,
  stop on disconnect).
- **Six new optional env vars**, all with sensible defaults, so it works out of the
  box and is easy to tune or switch off.

Nothing about the existing translation flow changes.

---

## 1. Background — where the "wait" actually happens

The caller is connected to Twilio **ConversationRelay** (a voice channel where our
server sends text/audio over a WebSocket and Twilio plays it to the caller). The
relevant flow in `local-server/server.mjs`:

1. Caller dials our Twilio number → `POST /twiml/inbound` returns
   `<Connect><ConversationRelay>` TwiML → the caller's audio is now bound to our
   WebSocket (`server.mjs` `inboundTwiml`, ~line 142).
2. The caller's WebSocket sends a `setup` message → `handleSetup` runs. For the
   caller leg it calls **`maybeDialAgent(party)`** (`server.mjs:312`), which places
   an **outbound REST call to the agent's phone** (`maybeDialAgent` → `createTwilioCall`,
   ~line 261).
3. **⏳ This is the wait window.** The agent's phone is ringing. The caller has heard
   the welcome greeting (`"Please wait while we connect you to a translator."`) and
   then hears **nothing**.
4. When the agent answers, the agent leg sends its own `setup` → `handleSetup`'s
   **callee branch** links the two legs and sends both sides
   `"The translation session has begun."` (`server.mjs:335`).

**Our change adds music during step 3 and ends it cleanly at step 4.**

---

## 2. Why this is possible — ConversationRelay's `play` message

ConversationRelay's server→Twilio WebSocket protocol has a native **`play`**
message that streams an audio file to the caller:

```json
{ "type": "play", "source": "https://.../hold.mp3", "loop": 0, "preemptible": true, "interruptible": false }
```

Two facts from the Twilio docs shaped the design:

- **`loop: 0` plays up to 1,000 times** (not literally infinite, but for a 30–60s
  track that's many hours — effectively endless for a hold).
- **There is no "stop playback" message.** The only documented way to stop a `play`
  early is to send a later `text`/`play` *while the music was marked
  `preemptible: true`*. This works in our favor: the existing
  `"The translation session has begun."` text naturally stops the music when the
  agent connects.

Sources:
- ConversationRelay WebSocket messages: https://www.twilio.com/docs/voice/conversationrelay/websocket-messages
- `<ConversationRelay>` TwiML: https://www.twilio.com/docs/voice/twiml/connect/conversationrelay

### The single-channel constraint (important to understand)

ConversationRelay gives each caller **one audio output channel** — we cannot mix
music *under* speech. So "music + a spoken line" is **sequential**: the line briefly
replaces the music, then music resumes. We get clean ordering using the
`preemptible` flag:

- Music is sent `preemptible: true` → a later **non-preemptible** `text` **stops** it.
- The spoken line is `preemptible: false` → a `play` sent right after it can't cut it
  off, so that `play` **queues** and **resumes the music** when the line finishes.

---

## 3. The change, step by step

### Step 1 — New module: `local-server/hold-music.mjs`

A self-contained module that knows nothing about HTTP/WebSocket plumbing. It takes
the caller `party`, a `send` function (the existing `sendWs`), and a `translate`
function (the existing `translateText`) — injected so the module is easy to unit
test. It exports two functions: `startHoldMusic` and `clearHoldMusic`.

```js
// local-server/hold-music.mjs
//
// Plays hold music to the caller while we wait for the agent leg to answer.
// ConversationRelay gives each caller a SINGLE audio channel, so the music and the
// spoken reassurance line are sequential, not mixed. We rely on the documented
// `preemptible` semantics to order them:
//   - music         -> preemptible:true  (a later non-preemptible text stops it)
//   - spoken line   -> preemptible:false (so a following `play` queues behind it)
//   - resume music  -> sent right after the line; it waits its turn, then plays.

const DEFAULT_MUSIC_URL = 'https://api.twilio.com/cowbell.mp3'; // obvious placeholder sample
const DEFAULT_LINE =
  "Thank you for your patience. We're still connecting you — please stay on the line.";
const DEFAULT_TIMEOUT_LINE =
  "We're sorry, no one is available to take your call right now. Please try again later.";

function envBool(value, fallback) {
  return value === undefined ? fallback : value === 'true';
}

/** Read config from env once (overridable for tests). */
export function holdMusicConfig(env = process.env) {
  return {
    enabled: envBool(env.HOLD_MUSIC_ENABLED, true),
    url: env.HOLD_MUSIC_URL || DEFAULT_MUSIC_URL,
    delayMs: Number(env.HOLD_MUSIC_DELAY_MS ?? 10000),
    timeoutMs: Number(env.HOLD_TIMEOUT_MS ?? 45000),
    message: env.HOLD_MUSIC_MESSAGE || DEFAULT_LINE,
    timeoutMessage: env.HOLD_TIMEOUT_MESSAGE || DEFAULT_TIMEOUT_LINE,
  };
}

/**
 * Start hold music for a caller leg and arm the two timers.
 * @param party     the caller connection object (we stash timer handles on it)
 * @param send      sendWs-style (ws, payload) => void
 * @param translate translateText-style (text, from, to) => Promise<string>
 * @param config    defaults to holdMusicConfig()
 * @param timers    setTimeout/clearTimeout (injectable for fake-timer tests)
 */
export function startHoldMusic(
  party,
  { send, translate, config = holdMusicConfig(), timers = { setTimeout, clearTimeout } } = {}
) {
  if (!config.enabled || !party?.ws) return;
  const lang = party.sourceLanguageCode || 'en';

  // (a) start looping music — preemptible so we can stop it later with a text
  send(party.ws, {
    type: 'play',
    source: config.url,
    loop: 0,
    preemptible: true,
    interruptible: false,
  });

  // (b) one spoken reassurance line ~delayMs in, then resume the music
  party.holdLineTimer = timers.setTimeout(async () => {
    const text = await localize(translate, config.message, lang);
    send(party.ws, { type: 'text', token: text, last: true, preemptible: false, interruptible: false });
    send(party.ws, { type: 'play', source: config.url, loop: 0, preemptible: true, interruptible: false });
  }, config.delayMs);

  // (c) no-answer timeout: apologize (stops the music) then hang up the caller leg
  party.holdTimeoutTimer = timers.setTimeout(async () => {
    const text = await localize(translate, config.timeoutMessage, lang);
    send(party.ws, { type: 'text', token: text, last: true, preemptible: false, interruptible: false });
    send(party.ws, { type: 'end', handoffData: JSON.stringify({ reasonCode: 'agent-no-answer' }) });
    clearHoldMusic(party, timers);
  }, config.timeoutMs);
}

/** Cancel both timers. Safe to call multiple times. */
export function clearHoldMusic(party, timers = { clearTimeout }) {
  if (party?.holdLineTimer) { timers.clearTimeout(party.holdLineTimer); party.holdLineTimer = null; }
  if (party?.holdTimeoutTimer) { timers.clearTimeout(party.holdTimeoutTimer); party.holdTimeoutTimer = null; }
}

/** Translate to the caller's language; fall back to English rather than going silent. */
async function localize(translate, text, lang) {
  if (!translate || !lang || lang === 'en' || lang.startsWith('en-')) return text;
  try {
    return await translate(text, 'en', lang);
  } catch {
    return text;
  }
}
```

**What each part does, in plain terms:**
- `holdMusicConfig()` — reads the six env vars once, applies defaults.
- `startHoldMusic()` — (a) starts the looping music immediately, (b) schedules the
  single spoken line + music-resume for ~10s later, (c) schedules the 45s no-answer
  timeout that apologizes and ends the call. Timer handles are stored on the caller
  `party` so they can be cancelled.
- `clearHoldMusic()` — cancels both timers (called on pickup and on disconnect).
- `localize()` — translates the line into the caller's language using the existing
  translate path; if the caller is English (or translation fails) it just uses
  English.

### Step 2 — Wire it into `local-server/server.mjs` (three edits)

**Edit 1 — import (top of file, near the other local imports ~line 10):**
```js
import { startHoldMusic, clearHoldMusic } from './hold-music.mjs';
```

**Edit 2 — START music after dialing the agent** (`handleSetup` caller branch,
`server.mjs:311`):
```js
  if (party.whichParty === 'caller') {
    await maybeDialAgent(party);
    if (process.env.AUTO_DIAL_AGENT === 'true') {
      startHoldMusic(party, { send: sendWs, translate: translateText });
    }
    return;
  }
```
Gated on `AUTO_DIAL_AGENT === 'true'` because if we're not auto-dialing an agent,
there's no ringing to wait through.

**Edit 3a — STOP music when the agent connects** (`handleSetup` callee branch, right
before the existing "session has begun" message, `server.mjs:335`):
```js
    clearHoldMusic(caller);
    sendWs(caller.ws, { type: 'text', token: 'The translation session has begun.', last: true });
```
`clearHoldMusic` cancels the pending line/timeout timers; the `text` itself stops the
music (the music was `preemptible: true`).

**Edit 3b — STOP music if the caller hangs up** (`handleDisconnect`, `server.mjs:402`):
```js
function handleDisconnect(connectionId) {
  const party = connections.get(connectionId);
  if (!party) return;
  clearHoldMusic(party);
  // ...existing disconnect logic...
}
```

### Step 3 — Configuration (new env vars + `.env.example`)

All optional, all defaulted:

| Var | Default | Purpose |
|-----|---------|---------|
| `HOLD_MUSIC_ENABLED` | `true` | Master on/off (set `false` for clean benchmark runs) |
| `HOLD_MUSIC_URL` | `https://api.twilio.com/cowbell.mp3` (placeholder) | The track to loop — replace with a branded MP3 |
| `HOLD_MUSIC_DELAY_MS` | `10000` | When the single spoken line plays |
| `HOLD_TIMEOUT_MS` | `45000` | No-answer hang-up |
| `HOLD_MUSIC_MESSAGE` | "Thank you for your patience…" | Reassurance line text |
| `HOLD_TIMEOUT_MESSAGE` | "We're sorry, no one is available…" | Apology line text |

Add the same six keys (with comments) to `.env.example`.

### Step 4 — Tests: `local-server/hold-music.test.mjs`

Uses Node's built-in test runner (`npm test`), matching the repo's existing
`*.test.mjs` files. The module's injected `send`/`translate`/`timers` make this a
pure unit test with **fake timers** (no real waiting):

- Sends a `play` with the configured `source`, `loop: 0`, `preemptible: true`.
- `HOLD_MUSIC_ENABLED=false` → nothing is sent.
- Advancing to `HOLD_MUSIC_DELAY_MS` → sends the translated `text` (non-preemptible)
  then a resume `play`.
- Advancing to `HOLD_TIMEOUT_MS` → sends the translated apology `text` then an `end`.
- `clearHoldMusic` before the delay → no line and no timeout fire afterward (proves
  no leaks and no line after pickup).
- Strings are translated with the caller's `sourceLanguageCode`.

---

## 4. The timeline (what the caller experiences)

```
t=0s    Welcome greeting: "Please wait while we connect you to a translator."
        ↓ (we dial the agent; agent's phone starts ringing)
t=0s    🎵 Hold music starts (loops)
t≈10s   🎤 "Thank you for your patience…" (caller's language) → 🎵 music resumes
        ↓
   ┌─ agent answers ──→ 🎵 stops, "The translation session has begun." → normal call
   │
   └─ nobody answers by 45s ──→ 🎵 stops, "We're sorry, no one is available…" → call ends
```

---

## 5. Caveats / things we explicitly decided

1. **The queue-ordering trick is the *implied* reading of Twilio's `preemptible`
   docs**, not something they spell out. It's the cleanest interpretation, and we'll
   confirm it on a real call during implementation. **Fallback if a trailing `play`
   interrupts instead of queues:** speak the line *first*, then start the music (no
   resume needed) — at the cost of the "10s in" timing.
2. **`loop: 0` is capped at 1,000 plays**, not truly infinite. Fine for a hold.
3. **The no-answer timeout hangs up the *caller* leg only.** The outbound agent dial
   isn't cancelled — it just stops ringing on its own. Cancelling the agent call is
   out of scope for this change.
4. **In test/benchmark mode**, set `HOLD_MUSIC_ENABLED=false` to keep timing clean.

---

## 6. Files touched (summary for the PR)

| File | Change |
|------|--------|
| `local-server/hold-music.mjs` | **New** — music/line/timeout logic |
| `local-server/hold-music.test.mjs` | **New** — unit tests |
| `local-server/server.mjs` | 3 edits: import, start music (caller setup), stop music (pickup + disconnect) |
| `.env.example` | Document the 6 new env vars |
