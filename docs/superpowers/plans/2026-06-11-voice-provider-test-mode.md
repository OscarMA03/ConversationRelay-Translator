# Voice Provider Test Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-rotating Polly voice-tier test combos (Generative/Neural/Standard) for real two-party ConversationRelay calls, with per-call timing capture and a comparison report.

**Architecture:** A combo registry (`combos.mjs`) supplies per-call provider/voice settings; `server.mjs` consumes it only when `PROVIDER_TEST_MODE=true`, announces the combo in the welcome greeting, and appends timestamped websocket events to `test-results.jsonl`. Pure functions in `metrics.mjs` (+ `stats.mjs`) turn the event log into per-combo summaries, served by `GET /results` and printed by `npm run report`.

**Tech Stack:** Node 25 ESM (`.mjs`), built-in `node:test` runner, no new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-06-11-voice-provider-test-mode-design.md`

## File Structure

- Create: `local-server/combos.mjs` — combo matrix, `getCombo()`, `nextCombo()` rotation with `TEST_COMBO` pinning, `resetRotation()` (test isolation)
- Create: `local-server/combos.test.mjs`
- Create: `local-server/stats.mjs` — `computeStats(samples)` → `{min, avg, p95}`
- Create: `local-server/stats.test.mjs`
- Create: `local-server/metrics.mjs` — `parseEvents(jsonlText)`, `summarize(events)` (pure, no I/O)
- Create: `local-server/metrics.test.mjs`
- Create: `local-server/report.mjs` — CLI table from `test-results.jsonl`
- Modify: `local-server/server.mjs` — test-mode TwiML overrides, `speechModel` attr, greeting, event recording, `/results`
- Modify: `package.json` — `report` script
- Modify: `.gitignore`, `.env.example`, `docs/voice-provider-comparison.md`

**Conventions:** tests stub `process.env` and restore via `t.after()`; run everything with `npm test` (= `node --test`, auto-discovers `*.test.mjs`).

---

### Task 1: Combo registry (matrix, lookup, rotation, pinning)

**Files:**
- Create: `local-server/combos.test.mjs`
- Create: `local-server/combos.mjs`

- [ ] **Step 1: Write the failing tests**

Create `local-server/combos.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { COMBOS, getCombo, nextCombo, resetRotation } from './combos.mjs';

function stubEnv(t, vars) {
  const saved = {};
  for (const [key, value] of Object.entries(vars)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test('matrix covers all three Polly tiers with Deepgram STT pinned', () => {
  assert.equal(COMBOS.length, 3);
  for (const combo of COMBOS) {
    assert.equal(combo.transcriptionProvider, 'Deepgram');
    assert.equal(combo.speechModel, 'nova-3-general');
    assert.equal(combo.ttsProvider, 'Amazon');
  }
  assert.deepEqual(COMBOS.map((c) => c.callerVoice), ['Matthew-Generative', 'Matthew-Neural', 'Matthew']);
  assert.deepEqual(COMBOS.map((c) => c.agentVoice), ['Lupe-Generative', 'Lupe-Neural', 'Lupe']);
});

test('getCombo accepts numeric strings and throws with valid ids', () => {
  assert.equal(getCombo('2').label, 'Polly Neural');
  assert.throws(() => getCombo(9), /Unknown test combo "9"\. Valid combos: 1, 2, 3/);
});

test('nextCombo rotates through the matrix and wraps', (t) => {
  stubEnv(t, { TEST_COMBO: undefined });
  resetRotation();
  t.after(resetRotation);
  assert.deepEqual(
    [nextCombo().id, nextCombo().id, nextCombo().id, nextCombo().id],
    [1, 2, 3, 1]
  );
});

test('TEST_COMBO pins rotation to one combo', (t) => {
  stubEnv(t, { TEST_COMBO: '3' });
  resetRotation();
  t.after(resetRotation);
  assert.equal(nextCombo().id, 3);
  assert.equal(nextCombo().id, 3);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module ... combos.mjs` (existing provider tests still pass)

- [ ] **Step 3: Implement the registry**

Create `local-server/combos.mjs`:

```js
/**
 * Voice provider test combos for PROVIDER_TEST_MODE.
 *
 * ConversationRelay has no AWS speech-to-text option (only Deepgram and
 * Google), so STT stays pinned at Deepgram nova-3 and the only variable is
 * the Amazon Polly TTS tier. Add rows here to test other providers later
 * (e.g. ElevenLabs, Google Chirp3-HD, Deepgram flux).
 */
export const COMBOS = [
  {
    id: 1,
    label: 'Polly Generative',
    transcriptionProvider: 'Deepgram',
    speechModel: 'nova-3-general',
    ttsProvider: 'Amazon',
    callerVoice: 'Matthew-Generative',
    agentVoice: 'Lupe-Generative'
  },
  {
    id: 2,
    label: 'Polly Neural',
    transcriptionProvider: 'Deepgram',
    speechModel: 'nova-3-general',
    ttsProvider: 'Amazon',
    callerVoice: 'Matthew-Neural',
    agentVoice: 'Lupe-Neural'
  },
  {
    id: 3,
    label: 'Polly Standard',
    transcriptionProvider: 'Deepgram',
    speechModel: 'nova-3-general',
    ttsProvider: 'Amazon',
    callerVoice: 'Matthew',
    agentVoice: 'Lupe'
  }
];

let rotation = 0;

export function getCombo(id) {
  const combo = COMBOS.find((c) => c.id === Number(id));
  if (!combo) {
    throw new Error(
      `Unknown test combo "${id}". Valid combos: ${COMBOS.map((c) => c.id).join(', ')}`
    );
  }
  return combo;
}

export function nextCombo() {
  if (process.env.TEST_COMBO) return getCombo(process.env.TEST_COMBO);
  const combo = COMBOS[rotation % COMBOS.length];
  rotation += 1;
  return combo;
}

export function resetRotation() {
  rotation = 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (4 new tests + existing provider tests)

- [ ] **Step 5: Commit**

```bash
git add local-server/combos.mjs local-server/combos.test.mjs
git commit -m "feat: add voice provider test combo registry with rotation and pinning"
```

---

### Task 2: Latency stats helper

**Files:**
- Create: `local-server/stats.test.mjs`
- Create: `local-server/stats.mjs`

- [ ] **Step 1: Write the failing tests**

Create `local-server/stats.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStats } from './stats.mjs';

test('computeStats returns null for no samples', () => {
  assert.equal(computeStats([]), null);
});

test('computeStats of a single sample is that sample', () => {
  assert.deepEqual(computeStats([42]), { min: 42, avg: 42, p95: 42 });
});

test('computeStats computes min, avg, and p95 over unsorted samples', () => {
  // 20 samples: 1..20 shuffled. p95 = 19th of 20 sorted values.
  const samples = [12, 3, 20, 7, 1, 16, 9, 14, 5, 18, 2, 11, 8, 19, 4, 15, 10, 6, 17, 13];
  const stats = computeStats(samples);
  assert.equal(stats.min, 1);
  assert.equal(stats.avg, 10.5);
  assert.equal(stats.p95, 19);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module ... stats.mjs`

- [ ] **Step 3: Implement computeStats**

Create `local-server/stats.mjs`:

```js
export function computeStats(samples) {
  if (samples.length === 0) return null;

  const sorted = [...samples].sort((a, b) => a - b);
  const min = sorted[0];
  const avg = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
  return { min, avg, p95 };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add local-server/stats.mjs local-server/stats.test.mjs
git commit -m "feat: add latency stats helper (min/avg/p95)"
```

---

### Task 3: Metrics (parseEvents + summarize)

**Files:**
- Create: `local-server/metrics.test.mjs`
- Create: `local-server/metrics.mjs`

Event shape (one JSON object per line in `test-results.jsonl`):
`{ ts, sessionId, comboId, leg: 'caller'|'callee', direction: 'in'|'out', type }`.
The server records `type: 'prompt'` when a transcript arrives, `type: 'text'`
when it forwards a translation to the other leg (where `leg` is the *receiving*
leg), and `type: 'setup'` on connection. `summarize` pairs them per session:

- **translate latency** — `prompt` in → next `text` out to the *other* leg
- **turn-around** — `text` out to leg B → next `prompt` in *from* leg B
- **prompts per leg** — fragmentation proxy (endpointing quality)

- [ ] **Step 1: Write the failing tests**

Create `local-server/metrics.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEvents, summarize } from './metrics.mjs';

const ev = (ts, sessionId, comboId, leg, direction, type) =>
  ({ ts, sessionId, comboId, leg, direction, type });

test('parseEvents reads JSON lines and skips blanks and garbage', () => {
  const text = '{"ts":1}\n\nnot json\n{"ts":2}\n';
  assert.deepEqual(parseEvents(text), [{ ts: 1 }, { ts: 2 }]);
});

test('summarize returns empty object for no events', () => {
  assert.deepEqual(summarize([]), {});
});

test('summarize computes translate latency, turn-around, and prompt counts for one session', () => {
  const events = [
    ev(1000, 's1', 1, 'caller', 'in', 'prompt'),
    ev(1150, 's1', 1, 'callee', 'out', 'text'),   // translate: 150
    ev(4000, 's1', 1, 'callee', 'in', 'prompt'),  // turn-around: 2850
    ev(4100, 's1', 1, 'caller', 'out', 'text'),   // translate: 100
    ev(7000, 's1', 1, 'caller', 'in', 'prompt')   // turn-around: 2900
  ];
  const summary = summarize(events);
  assert.equal(summary[1].sessions, 1);
  assert.equal(summary[1].turns, 2);
  assert.equal(summary[1].translateLatency.min, 100);
  assert.equal(summary[1].translateLatency.p95, 150);
  assert.equal(summary[1].turnAround.min, 2850);
  assert.equal(summary[1].turnAround.p95, 2900);
  assert.equal(summary[1].promptsPerLeg, 1.5); // caller spoke twice, callee once
});

test('summarize groups by combo and counts fragmented prompts', () => {
  const events = [
    // combo 1, session s1: utterance split into two prompts before the forward
    ev(1000, 's1', 1, 'caller', 'in', 'prompt'),
    ev(1500, 's1', 1, 'caller', 'in', 'prompt'),
    ev(1600, 's1', 1, 'callee', 'out', 'text'),  // translate pairs with latest fragment: 100
    // combo 2, session s2
    ev(9000, 's2', 2, 'caller', 'in', 'prompt'),
    ev(9300, 's2', 2, 'callee', 'out', 'text')   // translate: 300
  ];
  const summary = summarize(events);
  assert.deepEqual(Object.keys(summary).sort(), ['1', '2']);
  assert.equal(summary[1].translateLatency.avg, 100);
  assert.equal(summary[1].promptsPerLeg, 2);
  assert.equal(summary[2].translateLatency.avg, 300);
  assert.equal(summary[2].turnAround, null);
});

test('summarize ignores events without a comboId and non prompt/text types', () => {
  const events = [
    { ts: 1, sessionId: 's1', leg: 'caller', direction: 'in', type: 'prompt' },
    ev(2, 's1', 1, 'caller', 'in', 'setup'),
    ev(3, 's1', 1, 'caller', 'in', 'prompt')
  ];
  const summary = summarize(events);
  assert.deepEqual(Object.keys(summary), ['1']);
  assert.equal(summary[1].sessions, 1);
  assert.equal(summary[1].promptsPerLeg, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module ... metrics.mjs`

- [ ] **Step 3: Implement metrics**

Create `local-server/metrics.mjs`:

```js
import { computeStats } from './stats.mjs';

export function parseEvents(jsonlText) {
  return jsonlText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

export function summarize(events) {
  /** per-session pairing state: sessionId -> { lastPromptIn, lastTextOut } */
  const sessions = new Map();
  /** comboId -> accumulators */
  const byCombo = new Map();

  const sorted = [...events].sort((a, b) => a.ts - b.ts);

  for (const event of sorted) {
    if (event.comboId === undefined || event.comboId === null) continue;

    if (!byCombo.has(event.comboId)) {
      byCombo.set(event.comboId, {
        sessionIds: new Set(),
        translateSamples: [],
        turnAroundSamples: [],
        promptCounts: new Map()
      });
    }
    const bucket = byCombo.get(event.comboId);
    bucket.sessionIds.add(event.sessionId);

    if (!sessions.has(event.sessionId)) {
      sessions.set(event.sessionId, { lastPromptIn: null, lastTextOut: null });
    }
    const state = sessions.get(event.sessionId);

    if (event.direction === 'in' && event.type === 'prompt') {
      const legKey = `${event.sessionId}:${event.leg}`;
      bucket.promptCounts.set(legKey, (bucket.promptCounts.get(legKey) ?? 0) + 1);

      if (state.lastTextOut && state.lastTextOut.leg === event.leg) {
        bucket.turnAroundSamples.push(event.ts - state.lastTextOut.ts);
        state.lastTextOut = null;
      }
      state.lastPromptIn = { ts: event.ts, leg: event.leg };
    } else if (event.direction === 'out' && event.type === 'text') {
      if (state.lastPromptIn && state.lastPromptIn.leg !== event.leg) {
        bucket.translateSamples.push(event.ts - state.lastPromptIn.ts);
        state.lastPromptIn = null;
      }
      state.lastTextOut = { ts: event.ts, leg: event.leg };
    }
  }

  const summary = {};
  for (const [comboId, bucket] of byCombo) {
    const counts = [...bucket.promptCounts.values()];
    summary[comboId] = {
      sessions: bucket.sessionIds.size,
      turns: bucket.translateSamples.length,
      translateLatency: computeStats(bucket.translateSamples),
      turnAround: computeStats(bucket.turnAroundSamples),
      promptsPerLeg: counts.length
        ? counts.reduce((sum, n) => sum + n, 0) / counts.length
        : 0
    };
  }
  return summary;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add local-server/metrics.mjs local-server/metrics.test.mjs
git commit -m "feat: add timing metrics for voice provider test sessions"
```

---

### Task 4: Server test mode (TwiML overrides, recording, /results)

**Files:**
- Modify: `local-server/server.mjs`

- [ ] **Step 1: Add imports and recording helpers**

In `local-server/server.mjs`, after the existing imports (below `import { WebSocketServer } from 'ws';`), add:

```js
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getCombo, nextCombo } from './combos.mjs';
import { parseEvents, summarize } from './metrics.mjs';
```

After the `const transcript = [];` line, add:

```js
const RESULTS_FILE = fileURLToPath(new URL('./test-results.jsonl', import.meta.url));

function isTestMode() {
  return process.env.PROVIDER_TEST_MODE === 'true';
}

function recordEvent(event) {
  if (!isTestMode() || event.comboId === undefined || event.comboId === null) return;
  try {
    fs.appendFileSync(RESULTS_FILE, JSON.stringify(event) + '\n');
  } catch (error) {
    log('Failed to record test event:', error?.message ?? error);
  }
}

function readResults() {
  try {
    return parseEvents(fs.readFileSync(RESULTS_FILE, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}
```

- [ ] **Step 2: Thread the combo through the caller context and TwiML**

Change the `callerContext` signature and the three provider lines:

```js
function callerContext(params = {}, combo = null) {
```

```js
    sourceTranscriptionProvider: combo?.transcriptionProvider ?? process.env.CALLER_TRANSCRIPTION_PROVIDER ?? 'Deepgram',
    sourceTtsProvider: combo?.ttsProvider ?? process.env.CALLER_TTS_PROVIDER ?? 'Amazon',
    sourceVoice: combo?.callerVoice ?? process.env.CALLER_VOICE ?? 'Matthew-Generative',
```

and at the end of the returned object, after `targetCallSid: 'notset'`, add:

```js
    targetCallSid: 'notset',
    ...(combo ? { testComboId: combo.id } : {})
```

Replace `inboundTwiml` with:

```js
function inboundTwiml(req, twilioParams) {
  const combo = isTestMode() ? nextCombo() : null;
  const context = callerContext(twilioParams, combo);
  if (combo) log('test mode combo', { id: combo.id, label: combo.label });
  return buildConversationRelayTwiml({
    wsUrl: getWsUrl(req),
    relay: {
      welcomeGreeting: combo
        ? `Test combo ${combo.id}: ${combo.label}. Please wait while we connect you to a translator.`
        : 'Please wait while we connect you to a translator.',
      dtmfDetection: 'false',
      interruptByDtmf: 'false',
      language: context.sourceLanguage,
      transcriptionProvider: context.sourceTranscriptionProvider,
      ...(combo ? { speechModel: combo.speechModel } : {}),
      ttsProvider: context.sourceTtsProvider,
      voice: context.sourceVoice
    },
    params: context
  });
}
```

- [ ] **Step 3: Thread the combo through the agent leg**

Change the `agentContext` signature and provider lines:

```js
function agentContext(combo = null) {
  return {
    name: process.env.AGENT_NAME ?? 'Agent',
    sourceLanguageCode: process.env.AGENT_TRANSLATE_CODE ?? 'es',
    sourceLanguage: process.env.AGENT_LANGUAGE ?? 'es-MX',
    sourceLanguageFriendly: process.env.AGENT_LANGUAGE_FRIENDLY ?? 'Spanish - Mexico',
    sourceTranscriptionProvider: combo?.transcriptionProvider ?? process.env.AGENT_TRANSCRIPTION_PROVIDER ?? 'Deepgram',
    sourceTtsProvider: combo?.ttsProvider ?? process.env.AGENT_TTS_PROVIDER ?? 'Amazon',
    sourceVoice: combo?.agentVoice ?? process.env.AGENT_VOICE ?? 'Lupe-Generative'
  };
}
```

In `outboundAgentTwiml`, replace the first two lines of the function body:

```js
function outboundAgentTwiml(callerParty) {
  const combo = isTestMode() && callerParty.testComboId ? getCombo(callerParty.testComboId) : null;
  const context = agentContext(combo);
```

and inside its `params` object, after `targetCallSid: callerParty.callSid`, add:

```js
    targetCallSid: callerParty.callSid,
    ...(combo ? { testComboId: combo.id } : {})
```

and in its `relay` object, after the `transcriptionProvider` line, add:

```js
      transcriptionProvider: context.sourceTranscriptionProvider,
      ...(combo ? { speechModel: combo.speechModel } : {}),
```

- [ ] **Step 4: Record websocket events**

In `handleSetup`, after `party.translationActive = ...` inside the `party` object creation block, normalize the combo id — add this line right after the `const party = { ... };` statement:

```js
  party.testComboId = custom.testComboId ? Number(custom.testComboId) : undefined;
```

then after the existing `log('setup', ...)` line, add:

```js
  recordEvent({
    ts: Date.now(),
    sessionId: party.parentConnectionId,
    comboId: party.testComboId,
    leg: party.whichParty,
    direction: 'in',
    type: 'setup'
  });
```

In `handlePrompt`, after the `if (!text) return;` line, add:

```js
  recordEvent({
    ts: Date.now(),
    sessionId: party.parentConnectionId,
    comboId: party.testComboId,
    leg: party.whichParty,
    direction: 'in',
    type: 'prompt'
  });
```

and after the final `sendWs(target.ws, { type: 'text', token: translated, last: true });` line, add:

```js
  recordEvent({
    ts: Date.now(),
    sessionId: party.parentConnectionId,
    comboId: party.testComboId,
    leg: target.whichParty,
    direction: 'out',
    type: 'text'
  });
```

- [ ] **Step 5: Add the /results endpoint and TEST_COMBO startup validation**

In the HTTP handler, after the `/sessions` block, add:

```js
    if (url.pathname === '/results') {
      const summary = summarize(readResults());
      const labeled = Object.fromEntries(Object.entries(summary).map(([id, value]) => {
        let label;
        try {
          label = getCombo(id).label;
        } catch {
          label = `combo ${id}`;
        }
        return [id, { label, ...value }];
      }));
      send(res, 200, JSON.stringify(labeled, null, 2), 'application/json');
      return;
    }
```

Before the final `server.listen(...)` call, add:

```js
if (process.env.TEST_COMBO) {
  try {
    getCombo(process.env.TEST_COMBO);
  } catch (error) {
    console.error(String(error?.message ?? error));
    process.exit(1);
  }
}
```

- [ ] **Step 6: Run the test suite (no regressions)**

Run: `npm test`
Expected: PASS — server.mjs is not imported by tests, but this catches syntax errors via the combo/metrics modules it shares.

- [ ] **Step 7: Smoke-test test mode rotation and TwiML**

```bash
PROVIDER_TEST_MODE=true PUBLIC_BASE_URL=https://example.test node local-server/server.mjs &
sleep 1
for i in 1 2 3 4; do
  curl -s -X POST http://localhost:3000/twiml/inbound -d 'From=%2B15550001111&To=%2B15550002222' \
    | grep -o 'voice="[^"]*"\|speechModel="[^"]*"\|Test combo [0-9]: [^.]*'
done
curl -s http://localhost:3000/results
kill %1
```

Expected: the four calls show voices rotating `Matthew-Generative` → `Matthew-Neural` → `Matthew` → `Matthew-Generative`, each with `speechModel="nova-3-general"` and a matching `Test combo N: Polly ...` greeting; `/results` returns `{}`.

- [ ] **Step 8: Smoke-test that non-test mode is unchanged**

```bash
PUBLIC_BASE_URL=https://example.test node local-server/server.mjs &
sleep 1
curl -s -X POST http://localhost:3000/twiml/inbound -d 'From=%2B15550001111&To=%2B15550002222' \
  | grep -c 'speechModel\|testComboId\|Test combo'
kill %1
```

Expected: `0` (no test-mode attributes leak into normal TwiML; grep -c prints 0).

- [ ] **Step 9: Commit**

```bash
git add local-server/server.mjs
git commit -m "feat: add PROVIDER_TEST_MODE with combo rotation, timing capture, and /results"
```

---

### Task 5: Report script

**Files:**
- Create: `local-server/report.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add the npm script**

In `package.json`, add to `scripts` after `"benchmark"`:

```json
    "report": "node local-server/report.mjs"
```

- [ ] **Step 2: Write the report script**

Create `local-server/report.mjs`:

```js
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getCombo } from './combos.mjs';
import { parseEvents, summarize } from './metrics.mjs';

const file = fileURLToPath(new URL('./test-results.jsonl', import.meta.url));

let text = '';
try {
  text = fs.readFileSync(file, 'utf8');
} catch (error) {
  if (error.code === 'ENOENT') {
    console.error('No test results yet. Run calls with PROVIDER_TEST_MODE=true first.');
    process.exit(1);
  }
  throw error;
}

const summary = summarize(parseEvents(text));
const ids = Object.keys(summary).map(Number).sort((a, b) => a - b);
if (ids.length === 0) {
  console.error('test-results.jsonl has no usable events.');
  process.exit(1);
}

const ms = (stats) => (stats
  ? `${Math.round(stats.min)}/${Math.round(stats.avg)}/${Math.round(stats.p95)}`
  : '-');

console.log(
  'Combo  Label              Sessions  Turns   Translate ms (min/avg/p95)   Turn-around ms (min/avg/p95)  Prompts/leg'
);
console.log('-'.repeat(112));
for (const id of ids) {
  const row = summary[id];
  let label;
  try {
    label = getCombo(id).label;
  } catch {
    label = `combo ${id}`;
  }
  console.log(
    String(id).padEnd(7)
    + label.padEnd(19)
    + String(row.sessions).padStart(8)
    + String(row.turns).padStart(7)
    + ms(row.translateLatency).padStart(29)
    + ms(row.turnAround).padStart(30)
    + row.promptsPerLeg.toFixed(1).padStart(13)
  );
}
console.log('\nTurn-around includes TTS playback, the listener\'s reply, STT, and endpointing —');
console.log('compare combos only across calls that followed the same script.');
```

- [ ] **Step 3: Smoke-test with fixture data**

```bash
cat > local-server/test-results.jsonl <<'EOF'
{"ts":1000,"sessionId":"s1","comboId":1,"leg":"caller","direction":"in","type":"prompt"}
{"ts":1150,"sessionId":"s1","comboId":1,"leg":"callee","direction":"out","type":"text"}
{"ts":4000,"sessionId":"s1","comboId":1,"leg":"callee","direction":"in","type":"prompt"}
EOF
npm run report
rm local-server/test-results.jsonl
```

Expected: a table with one row — combo `1`, label `Polly Generative`, 1 session, 1 turn, translate `150/150/150`, turn-around `2850/2850/2850`, prompts/leg `1.0`.

- [ ] **Step 4: Verify the missing-file path**

Run: `npm run report; echo "exit: $?"`
Expected: `No test results yet. Run calls with PROVIDER_TEST_MODE=true first.` and `exit: 1`.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add local-server/report.mjs package.json
git commit -m "feat: add per-combo timing report for voice provider tests"
```

---

### Task 6: Environment, gitignore, and protocol docs

**Files:**
- Modify: `.gitignore`
- Modify: `.env.example`
- Modify: `docs/voice-provider-comparison.md`

- [ ] **Step 1: Gitignore the results log**

In `.gitignore`, after the `lambda-invoke-response.json` line, add:

```
local-server/test-results.jsonl
```

- [ ] **Step 2: Document the env vars**

Append to `.env.example`:

```bash

# Voice provider test mode: each inbound call rotates to the next Polly tier
# combo (1=Generative, 2=Neural, 3=Standard) and timing events are appended to
# local-server/test-results.jsonl. See npm run report and GET /results.
PROVIDER_TEST_MODE=false
# Pin a single combo id instead of rotating.
# TEST_COMBO=1
```

- [ ] **Step 3: Add the test protocol to the comparison doc**

In `docs/voice-provider-comparison.md`, replace the `## Trying a different combo` section (heading through the closing code fence) with:

````markdown
## Testing the Polly tiers (test mode)

The local server has a built-in test mode that rotates through every Amazon
Polly tier available in ConversationRelay and records timing:

| Combo | TTS tier | Caller / agent voice |
|---|---|---|
| 1 | Polly Generative (current default) | Matthew-Generative / Lupe-Generative |
| 2 | Polly Neural | Matthew-Neural / Lupe-Neural |
| 3 | Polly Standard | Matthew / Lupe |

STT stays on Deepgram nova-3 for every combo — ConversationRelay has no AWS
speech-to-text option.

### Protocol

1. Set `PROVIDER_TEST_MODE=true` in `.env`, start the server and ngrok, and
   have both testers ready (`AUTO_DIAL_AGENT=true` dials the second phone).
2. Call in 3 times. The welcome greeting announces the active combo
   ("Test combo 2: Polly Neural"). Set `TEST_COMBO=2` to pin one instead.
3. Read the same short script on every call, and reply immediately when you
   hear each translated phrase — that keeps the timing comparable.
4. Note per call: first-word delay, naturalness, pronunciation of numbers and
   names.
5. Run `npm run report` (or `GET /results`) for the per-combo table:
   sessions, turns, translate latency, turn-around time, and prompts-per-leg
   (lower = cleaner endpointing).

Turn-around time includes TTS synthesis + playback, the listener's reply, and
transcription — only *differences between combos* are meaningful, and only
when calls follow the same script. Voice quality is judged by ear.

### Switching providers outside test mode

```bash
CALLER_TRANSCRIPTION_PROVIDER=Deepgram   # or Google
CALLER_TTS_PROVIDER=Amazon               # or ElevenLabs, Google
CALLER_VOICE=Matthew-Generative          # provider-specific voice ID
```
````

- [ ] **Step 4: Commit**

```bash
git add .gitignore .env.example docs/voice-provider-comparison.md
git commit -m "docs: voice provider test mode env vars and call protocol"
```

---

### Task 7: Final verification

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS, 0 failures

- [ ] **Step 2: End-to-end smoke (TwiML rotation, results endpoint, invalid pin)**

```bash
rm -f local-server/test-results.jsonl
PROVIDER_TEST_MODE=true PUBLIC_BASE_URL=https://example.test node local-server/server.mjs &
sleep 1
curl -s -X POST http://localhost:3000/twiml/inbound -d 'From=%2B15550001111' | grep -o 'Test combo 1[^.]*'
curl -s http://localhost:3000/results
kill %1
TEST_COMBO=9 node local-server/server.mjs; echo "exit: $?"
```

Expected: greeting line `Test combo 1: Polly Generative`, `/results` returns `{}`, and the `TEST_COMBO=9` start prints `Unknown test combo "9". Valid combos: 1, 2, 3` with `exit: 1`.

- [ ] **Step 3: Clean tree**

Run: `git status`
Expected: clean working tree (test-results.jsonl ignored if present).
