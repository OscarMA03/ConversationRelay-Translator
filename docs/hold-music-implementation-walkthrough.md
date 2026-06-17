# Hold Music — What We Built & How (implementation walkthrough)

**Date:** 2026-06-17 · **Branch:** `testing-branch` · **Status:** implemented, reviewed, 42/42 tests passing (not yet pushed)

This is the teammate-facing record of the hold-music feature: the process we
followed, every file that changed, and the exact code — so anyone can see what
was added and what each piece does.

---

## 1. The idea

When someone calls in, the server immediately dials the agent's phone and the
caller hears **silence** while it rings. This feature fills that gap:

> 🎵 looping hold music → 🎤 a reassurance line first ~10s in, then repeated every
> ~15s (in the caller's language) → 🎵 music resumes after each line → music **stops**
> when the agent answers (or the caller hangs up) → ⏱️ if no one answers in 45s,
> apologize and end the call.

## 2. How we got here (process)

1. **Brainstormed** the idea → confirmed feasibility against Twilio's docs (the
   ConversationRelay WebSocket has a native `play` message).
2. **Wrote a design spec** → `docs/superpowers/specs/2026-06-17-hold-music-while-waiting-design.md`.
3. **Wrote an implementation plan** (TDD, bite-sized tasks) →
   `docs/superpowers/plans/2026-06-17-hold-music-while-waiting.md`.
4. **Implemented task-by-task** with test-first development and per-task code review.
5. **Final whole-feature review** → flagged one real foot-gun (NaN env values),
   which we fixed.

## 3. The key technical fact that makes this possible

ConversationRelay gives each caller a **single audio output channel** — you can't
mix music *under* speech. So music and the spoken line are **sequential**. We order
them using Twilio's documented `preemptible` flag:

| Message | `preemptible` | Behavior |
|---------|--------------|----------|
| music (`play`) | `true` | a later `text`/`play` **stops** it |
| spoken line (`text`) | `false` | can't be cut off → a following `play` **queues** behind it |
| resume music (`play`) | `true` | waits its turn, then plays |

Also: `loop: 0` means "repeat up to 1000×" (effectively endless for a hold), and
there is **no explicit stop message** — sending the existing "session has begun"
text is what stops the music when the agent connects.

Docs: https://www.twilio.com/docs/voice/conversationrelay/websocket-messages

---

## 4. Files changed (4 files, +241 lines)

```
.env.example                     |  14 +   (document 6 new env vars)
local-server/hold-music.mjs      |  93 +   NEW — all the logic
local-server/hold-music.test.mjs | 127 +   NEW — 8 unit tests
local-server/server.mjs          |   7 +   wire it in at 3 points
```

Commits (on `testing-branch`):
- `e750023` feat: hold-music module for waiting-for-agent gap
- `fb979f7` feat: play hold music while caller waits for agent pickup
- `d03c8c6` docs: document hold-music env vars in .env.example
- `485fa21` fix: guard hold-music delays against NaN env values

---

## 5. NEW FILE — `local-server/hold-music.mjs` (the whole feature)

A self-contained module. It knows nothing about HTTP/WebSockets — it receives
`send` (how to talk to the caller), `translate` (how to localize text), and
`timers` as **injected arguments**, which is what makes it unit-testable.

**Three exported functions:**

### `holdMusicConfig(env)` — reads the 6 env vars with defaults
```js
function envBool(value, fallback) {
  return value === undefined ? fallback : value === 'true';
}

// Parse a millisecond env value, falling back on anything non-finite. Guards
// against a typo'd value (e.g. "abc") becoming NaN -> setTimeout(0), which would
// fire the line immediately or hang the caller up almost instantly.
function envMs(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function holdMusicConfig(env = process.env) {
  return {
    enabled: envBool(env.HOLD_MUSIC_ENABLED, true),
    url: env.HOLD_MUSIC_URL || DEFAULT_MUSIC_URL,
    delayMs: envMs(env.HOLD_MUSIC_DELAY_MS, 10000),
    repeatMs: envMs(env.HOLD_MUSIC_REPEAT_MS, 15000),
    timeoutMs: envMs(env.HOLD_TIMEOUT_MS, 45000),
    message: env.HOLD_MUSIC_MESSAGE || DEFAULT_LINE,
    timeoutMessage: env.HOLD_TIMEOUT_MESSAGE || DEFAULT_TIMEOUT_LINE,
  };
}
```
> The `envMs` guard is the fix from final review: without it, `HOLD_TIMEOUT_MS=abc`
> becomes `NaN`, and `setTimeout(fn, NaN)` runs at `0ms` — instantly hanging up the
> caller. Now a bad value safely falls back to the default.

### `startHoldMusic(party, {...})` — starts music + arms the two timers
```js
function playMusic(send, ws, url) {
  send(ws, { type: 'play', source: url, loop: 0, preemptible: true, interruptible: false });
}

function speak(send, ws, token) {
  send(ws, { type: 'text', token, last: true, preemptible: false, interruptible: false });
}

export function startHoldMusic(
  party,
  { send, translate, config = holdMusicConfig(), timers = { setTimeout, clearTimeout } } = {}
) {
  if (!config.enabled || !party?.ws) return;
  const lang = party.sourceLanguageCode || 'en';

  // (a) start looping music — preemptible so a later text can stop it
  playMusic(send, party.ws, config.url);

  // (b) speak the reassurance line ~delayMs in, then repeat it every repeatMs
  const speakAndRepeat = async () => {
    speak(send, party.ws, await localize(translate, config.message, lang));
    playMusic(send, party.ws, config.url);
    party.holdLineTimer = timers.setTimeout(speakAndRepeat, config.repeatMs);
  };
  party.holdLineTimer = timers.setTimeout(speakAndRepeat, config.delayMs);

  // (c) no-answer timeout: apologize (stops the music) then hang up the caller leg
  party.holdTimeoutTimer = timers.setTimeout(async () => {
    speak(send, party.ws, await localize(translate, config.timeoutMessage, lang));
    send(party.ws, { type: 'end', handoffData: JSON.stringify({ reasonCode: 'agent-no-answer' }) });
    clearHoldMusic(party, timers);
  }, config.timeoutMs);
}
```
- **(a)** plays music immediately (after Twilio finishes the welcome greeting).
- **(b)** a timer at `delayMs` (default 10s) speaks the line and resumes music, then
  re-arms itself every `repeatMs` (default 15s) so the line repeats until pickup or
  timeout. Re-assigning `party.holdLineTimer` each cycle means `clearHoldMusic` stops
  the whole chain.
- **(c)** a timer at `timeoutMs` (default 45s) apologizes and sends `end` (hang up).
- Timer handles are stored **on the caller's connection object** (`party.holdLineTimer`,
  `party.holdTimeoutTimer`) so they can be cancelled later.

### `clearHoldMusic(party, timers)` — cancels the timers (idempotent)
```js
export function clearHoldMusic(party, timers = { clearTimeout }) {
  if (party?.holdLineTimer) { timers.clearTimeout(party.holdLineTimer); party.holdLineTimer = null; }
  if (party?.holdTimeoutTimer) { timers.clearTimeout(party.holdTimeoutTimer); party.holdTimeoutTimer = null; }
}
```

### `localize(...)` — translate to the caller's language, fail open to English
```js
async function localize(translate, text, lang) {
  if (!translate || !lang || lang === 'en' || lang.startsWith('en-')) return text;
  try {
    return await translate(text, 'en', lang);
  } catch {
    return text; // never go silent if translation fails
  }
}
```

---

## 6. CHANGED FILE — `local-server/server.mjs` (3 hook points, +7 lines)

This is the **entire** diff to the server:

```diff
 import { translateText } from './providers.mjs';
+import { startHoldMusic, clearHoldMusic } from './hold-music.mjs';
```
```diff
   if (party.whichParty === 'caller') {
     await maybeDialAgent(party);
+    if (process.env.AUTO_DIAL_AGENT === 'true') {
+      startHoldMusic(party, { send: sendWs, translate: translateText });
+    }
     return;
   }
```
```diff
     party.translationActive = true;
     party.targetConnectionId = caller.pk;

+    clearHoldMusic(caller);
     sendWs(caller.ws, { type: 'text', token: 'The translation session has begun.', last: true });
     sendWs(party.ws, { type: 'text', token: 'The translation session has begun.', last: true });
```
```diff
   const party = connections.get(connectionId);
   if (!party) return;

+  clearHoldMusic(party);
+
   party.callStatus = 'disconnected';
```

**What each hook does:**
1. **Import** the two functions.
2. **Start** music right after we dial the agent — only when `AUTO_DIAL_AGENT=true`
   (no agent being dialed = nothing to wait for).
3. **Stop on pickup:** when the agent's leg links up, `clearHoldMusic(caller)` cancels
   the pending timers, and the existing "session has begun" `text` stops the music.
4. **Stop on disconnect:** if the caller hangs up first, cancel the timers so nothing
   leaks.

---

## 7. CHANGED FILE — `.env.example` (6 new settings)

```bash
# --- Hold music (while the caller waits for the agent to pick up) ---
# Master on/off. Set false for clean benchmark/test runs.
HOLD_MUSIC_ENABLED=true
# Looped track. Default is a Twilio sample (cowbell) — replace with a branded MP3.
HOLD_MUSIC_URL=https://api.twilio.com/cowbell.mp3
# How long after dialing the agent before the spoken reassurance line first plays.
HOLD_MUSIC_DELAY_MS=10000
# After the first line, repeat it every this many ms until pickup/timeout.
HOLD_MUSIC_REPEAT_MS=15000
# No-answer timeout: after this, apologize to the caller and hang up.
HOLD_TIMEOUT_MS=45000
# Reassurance line (auto-translated to the caller's language).
HOLD_MUSIC_MESSAGE=Thank you for your patience. We're still connecting you — please stay on the line.
# Apology line played on no-answer timeout (auto-translated).
HOLD_TIMEOUT_MESSAGE=We're sorry, no one is available to take your call right now. Please try again later.
```

> ⚠️ The default `HOLD_MUSIC_URL` is Twilio's **cowbell** sample — an obvious
> placeholder. Set a real branded MP3 URL before using this for anything real.

---

## 8. NEW FILE — `local-server/hold-music.test.mjs` (8 tests)

Pure unit tests using Node's built-in runner with **injected fakes** (a `send` that
records messages, a `translate` that tags the language, and a manual timer store so
time is controlled, not waited on). They assert exact message payloads. Run with
`npm test`. Coverage:

1. start sends a looping, preemptible `play`
2. `HOLD_MUSIC_ENABLED=false` → sends nothing
3. at the delay → translated line, then resume `play`
4. the line **repeats** every `repeatMs`, each followed by a resume `play`
5. `clearHoldMusic` stops further repeats
6. English caller → line not translated
7. at the timeout → translated apology, then `end`
8. malformed numeric env → falls back to default delays
9. a failing `translate` → falls back to the English line, never silent
10. `clearHoldMusic` → cancels both timers (no line, no timeout fire)

```
$ npm test
ℹ tests 44
ℹ pass 44
ℹ fail 0
```

---

## 9. Known caveat to confirm on a live call

The one thing unit tests can't prove is Twilio's **real** `preemptible` queue
ordering — i.e. that after the spoken line at ~10s, the music actually **resumes**
(rather than the trailing `play` cutting the line off). See the live-test steps
below. **Fallback if resume misbehaves:** speak the line *first*, then start the
music (no resume needed) — set `HOLD_MUSIC_DELAY_MS=0` and move the `play` after the
`speak` in `startHoldMusic`.

---

## 10. How to run the live test

Prerequisites: a Twilio number, `ngrok`, AWS Translate creds (or `TRANSLATION_PROVIDER=mock`),
and a second phone to act as the agent.

1. **Configure `.env`** — set `AUTO_DIAL_AGENT=true`, `AGENT_PHONE_NUMBER`,
   `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_DEFAULT_FROM`, `PUBLIC_BASE_URL`
   (your ngrok URL), and optionally a real `HOLD_MUSIC_URL`.
2. **Start the server:** `npm run local`
3. **Start the tunnel:** `ngrok http 3000` → copy the HTTPS URL into `PUBLIC_BASE_URL`.
4. **Point your Twilio number's Voice webhook** at `https://<ngrok>/twiml/inbound`.
5. **Call the number** and verify, in order:
   - Music starts after the welcome greeting while the agent's phone rings.
   - ~10s in: the reassurance line plays, **then music resumes**. ← the caveat check.
   - The line then **repeats every ~15s** (so again around ~25s, ~40s).
   - Answer as the agent → music stops, normal translated call begins.
6. **No-answer test:** call again, don't answer the agent for 45s → confirm the
   apology plays and the call ends.

To disable for clean benchmark runs: `HOLD_MUSIC_ENABLED=false`.
