# Hold Music While Waiting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play looping hold music (plus one spoken reassurance line, then an apology+hangup on no-answer) to the caller while the agent's phone rings.

**Architecture:** A self-contained `local-server/hold-music.mjs` module owns all music/line/timeout logic; it receives `send` (the existing `sendWs`), `translate` (the existing `translateText`), and `timers` as injected dependencies so it is fully unit-testable with fake timers. `server.mjs` wires it in at three points: start music after dialing the agent, and stop it when the agent connects or the caller disconnects.

**Tech Stack:** Node.js (ESM `.mjs`), Twilio ConversationRelay WebSocket `play`/`text`/`end` messages, Node's built-in `node:test` runner, AWS Translate via existing `translateText`.

**Spec:** `docs/superpowers/specs/2026-06-17-hold-music-while-waiting-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `local-server/hold-music.mjs` | **New.** Config reader + `startHoldMusic` (initial play, delayed line + resume, no-answer timeout) + `clearHoldMusic` (cancel timers). No HTTP/WS knowledge. |
| `local-server/hold-music.test.mjs` | **New.** Unit tests with injected fakes + manual timer control. |
| `local-server/server.mjs` | **Modify.** Import the module; start music in `handleSetup` caller branch; clear it in `handleSetup` callee branch and in `handleDisconnect`. |
| `.env.example` | **Modify.** Document the 6 new optional env vars. |

---

## Task 1: The `hold-music.mjs` module (test-driven)

This is one cohesive ~75-line unit. Write the full test file first, watch it fail, then implement the module.

**Files:**
- Create: `local-server/hold-music.mjs`
- Test: `local-server/hold-music.test.mjs`

- [ ] **Step 1: Write the failing test file**

Create `local-server/hold-music.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { startHoldMusic, clearHoldMusic, holdMusicConfig } from './hold-music.mjs';

const COWBELL = 'https://api.twilio.com/cowbell.mp3';

// Builds fakes: a `send` that records payloads, a `translate` that tags the
// target language, and a manual timer store so tests control time precisely.
function harness({ env = {}, party = {} } = {}) {
  const sent = [];
  const send = (_ws, payload) => sent.push(payload);
  const translate = async (text, _from, to) => `[${to}] ${text}`;
  const scheduled = [];
  const timers = {
    setTimeout: (fn, ms) => {
      const t = { fn, ms, cancelled: false };
      scheduled.push(t);
      return t;
    },
    clearTimeout: (t) => { if (t) t.cancelled = true; },
  };
  // Fire every timer scheduled for exactly `ms`, unless cancelled.
  const runMs = async (ms) => {
    for (const t of scheduled) if (t.ms === ms && !t.cancelled) await t.fn();
  };
  const config = holdMusicConfig(env);
  const callerParty = { ws: {}, sourceLanguageCode: 'es', ...party };
  return { sent, send, translate, timers, runMs, config, party: callerParty };
}

function start(h) {
  startHoldMusic(h.party, {
    send: h.send,
    translate: h.translate,
    config: h.config,
    timers: h.timers,
  });
}

test('startHoldMusic sends a looping, preemptible play immediately', () => {
  const h = harness();
  start(h);
  assert.equal(h.sent.length, 1);
  assert.deepEqual(h.sent[0], {
    type: 'play',
    source: COWBELL,
    loop: 0,
    preemptible: true,
    interruptible: false,
  });
});

test('disabled config sends nothing', () => {
  const h = harness({ env: { HOLD_MUSIC_ENABLED: 'false' } });
  start(h);
  assert.equal(h.sent.length, 0);
});

test('at the delay it speaks the translated line, then resumes music', async () => {
  const h = harness();
  start(h);
  await h.runMs(10000);
  const after = h.sent.slice(1);
  assert.equal(after.length, 2);
  assert.deepEqual(after[0], {
    type: 'text',
    token: `[es] ${h.config.message}`,
    last: true,
    preemptible: false,
    interruptible: false,
  });
  assert.deepEqual(after[1], {
    type: 'play',
    source: COWBELL,
    loop: 0,
    preemptible: true,
    interruptible: false,
  });
});

test('English caller keeps the untranslated line', async () => {
  const h = harness({ party: { sourceLanguageCode: 'en' } });
  start(h);
  await h.runMs(10000);
  assert.equal(h.sent[1].token, h.config.message);
});

test('at the timeout it apologizes (translated), then ends the call', async () => {
  const h = harness();
  start(h);
  await h.runMs(45000);
  const after = h.sent.slice(1);
  assert.deepEqual(after[0], {
    type: 'text',
    token: `[es] ${h.config.timeoutMessage}`,
    last: true,
    preemptible: false,
    interruptible: false,
  });
  assert.deepEqual(after[1], {
    type: 'end',
    handoffData: JSON.stringify({ reasonCode: 'agent-no-answer' }),
  });
});

test('clearHoldMusic cancels pending line and timeout timers', async () => {
  const h = harness();
  start(h);
  clearHoldMusic(h.party, h.timers);
  await h.runMs(10000);
  await h.runMs(45000);
  assert.equal(h.sent.length, 1); // only the initial play ever fired
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './hold-music.mjs'` (the module doesn't exist yet).

- [ ] **Step 3: Implement the module**

Create `local-server/hold-music.mjs`:

```js
// Plays hold music to the caller while we wait for the agent leg to answer.
// ConversationRelay gives each caller a SINGLE audio channel, so the music and the
// spoken reassurance line are sequential, not mixed. We rely on the documented
// `preemptible` semantics to order them:
//   - music        -> preemptible:true  (a later non-preemptible text stops it)
//   - spoken line  -> preemptible:false (so a following `play` queues behind it)
//   - resume music -> sent right after the line; it waits its turn, then plays.

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

function playMusic(send, ws, url) {
  send(ws, { type: 'play', source: url, loop: 0, preemptible: true, interruptible: false });
}

function speak(send, ws, token) {
  send(ws, { type: 'text', token, last: true, preemptible: false, interruptible: false });
}

/**
 * Start hold music for a caller leg and arm the two timers.
 * @param party     caller connection object (timer handles are stashed on it)
 * @param send      sendWs-style (ws, payload) => void
 * @param translate translateText-style (text, from, to) => Promise<string>
 * @param config    defaults to holdMusicConfig()
 * @param timers    setTimeout/clearTimeout (injectable for tests)
 */
export function startHoldMusic(
  party,
  { send, translate, config = holdMusicConfig(), timers = { setTimeout, clearTimeout } } = {}
) {
  if (!config.enabled || !party?.ws) return;
  const lang = party.sourceLanguageCode || 'en';

  // (a) start looping music — preemptible so a later text can stop it
  playMusic(send, party.ws, config.url);

  // (b) one spoken reassurance line ~delayMs in, then resume the music
  party.holdLineTimer = timers.setTimeout(async () => {
    speak(send, party.ws, await localize(translate, config.message, lang));
    playMusic(send, party.ws, config.url);
  }, config.delayMs);

  // (c) no-answer timeout: apologize (stops the music) then hang up the caller leg
  party.holdTimeoutTimer = timers.setTimeout(async () => {
    speak(send, party.ws, await localize(translate, config.timeoutMessage, lang));
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all 6 `hold-music` tests green (existing suites unaffected).

- [ ] **Step 5: Commit**

```bash
git add local-server/hold-music.mjs local-server/hold-music.test.mjs
git commit -m "feat: hold-music module for waiting-for-agent gap"
```

---

## Task 2: Wire the module into `server.mjs`

**Files:**
- Modify: `local-server/server.mjs` (import ~line 10; caller branch line 311; callee branch line 335; `handleDisconnect` line 402)

- [ ] **Step 1: Add the import**

Near the other local imports (after `import { translateText } from './providers.mjs';`, ~line 12), add:

```js
import { startHoldMusic, clearHoldMusic } from './hold-music.mjs';
```

- [ ] **Step 2: Start music after dialing the agent**

In `handleSetup`, replace the caller branch (currently `server.mjs:311-314`):

```js
  if (party.whichParty === 'caller') {
    await maybeDialAgent(party);
    return;
  }
```

with:

```js
  if (party.whichParty === 'caller') {
    await maybeDialAgent(party);
    if (process.env.AUTO_DIAL_AGENT === 'true') {
      startHoldMusic(party, { send: sendWs, translate: translateText });
    }
    return;
  }
```

- [ ] **Step 3: Stop music when the agent connects**

In `handleSetup`'s callee branch, find (currently `server.mjs:335`):

```js
    sendWs(caller.ws, { type: 'text', token: 'The translation session has begun.', last: true });
```

and insert the clear call immediately before it:

```js
    clearHoldMusic(caller);
    sendWs(caller.ws, { type: 'text', token: 'The translation session has begun.', last: true });
```

- [ ] **Step 4: Stop music when the caller disconnects**

In `handleDisconnect` (currently `server.mjs:402-408`), add `clearHoldMusic(party)` right after the early-return guard:

```js
function handleDisconnect(connectionId) {
  const party = connections.get(connectionId);
  if (!party) return;

  clearHoldMusic(party);

  party.callStatus = 'disconnected';
  connections.delete(connectionId);
```

- [ ] **Step 5: Verify the server still loads (syntax/import check)**

Run: `node --check local-server/server.mjs && node -e "import('./local-server/hold-music.mjs').then(m => console.log(Object.keys(m).join(',')))"`
Expected: prints `holdMusicConfig,startHoldMusic,clearHoldMusic` with no syntax errors.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS — all suites green (no regressions).

- [ ] **Step 7: Commit**

```bash
git add local-server/server.mjs
git commit -m "feat: play hold music while caller waits for agent pickup"
```

---

## Task 3: Document the new env vars in `.env.example`

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Append the hold-music settings**

Add this block to the end of `.env.example`:

```bash
# --- Hold music (while the caller waits for the agent to pick up) ---
# Master on/off. Set false for clean benchmark/test runs.
HOLD_MUSIC_ENABLED=true
# Looped track. Default is a Twilio sample (cowbell) — replace with a branded MP3.
HOLD_MUSIC_URL=https://api.twilio.com/cowbell.mp3
# How long after dialing the agent before the single spoken reassurance line plays.
HOLD_MUSIC_DELAY_MS=10000
# No-answer timeout: after this, apologize to the caller and hang up.
HOLD_TIMEOUT_MS=45000
# Reassurance line (auto-translated to the caller's language).
HOLD_MUSIC_MESSAGE=Thank you for your patience. We're still connecting you — please stay on the line.
# Apology line played on no-answer timeout (auto-translated).
HOLD_TIMEOUT_MESSAGE=We're sorry, no one is available to take your call right now. Please try again later.
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: document hold-music env vars in .env.example"
```

---

## Manual verification (after all tasks, on a real call)

The one behavior unit tests can't prove is Twilio's actual `preemptible` queue
ordering (see spec §5, caveat 1). On a live two-party call with `AUTO_DIAL_AGENT=true`:

1. Call in; confirm music starts after the welcome greeting while the agent rings.
2. Confirm the spoken line plays ~10s in **and music resumes** afterward.
3. Answer as the agent; confirm music stops and the normal translated call proceeds.
4. Separately, let it ring 45s with no answer; confirm the apology plays and the call ends.

If step 2's music does **not** resume (a trailing `play` interrupts instead of
queuing), apply the spec's fallback: in `startHoldMusic`, speak the line *first* and
start the music *after* it (drop the initial `playMusic` call and the resume; move
`playMusic` into the line timer after `speak`, with `delayMs` set to `0`).

---

## Self-Review

- **Spec coverage:** music start (Task 2 step 2), single line ~10s in (Task 1 line timer), caller-language translation (Task 1 `localize`), stop on pickup (Task 2 step 3), stop on disconnect (Task 2 step 4), no-answer timeout→apology→end (Task 1 timeout timer), 6 env vars (Task 3), unit tests (Task 1), live-call caveat (Manual verification). All covered.
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type consistency:** `startHoldMusic`/`clearHoldMusic`/`holdMusicConfig` names and signatures match between module, tests, and `server.mjs` wiring; payload shapes (`play`/`text`/`end`) identical in tests and implementation.
