import { test } from 'node:test';
import assert from 'node:assert/strict';

import { startHoldMusic, clearHoldMusic, holdMusicConfig } from './hold-music.mjs';

const COWBELL = 'https://api.twilio.com/cowbell.mp3';

// Builds fakes: a `send` that records payloads, a `translate` that tags the
// target language, and a manual timer store so tests control time precisely.
function harness({ env = {}, party = {}, translate } = {}) {
  const sent = [];
  const send = (_ws, payload) => sent.push(payload);
  translate = translate ?? (async (text, _from, to) => `[${to}] ${text}`);
  const scheduled = [];
  const timers = {
    setTimeout: (fn, ms) => {
      const t = { fn, ms, cancelled: false };
      scheduled.push(t);
      return t;
    },
    clearTimeout: (t) => { if (t) t.cancelled = true; },
  };
  // Fire every timer currently scheduled for exactly `ms`, unless cancelled.
  // Snapshot first so a callback that re-arms a timer at the same `ms` (the
  // repeating line) doesn't get fired again within this same tick.
  const runMs = async (ms) => {
    const due = scheduled.filter((t) => t.ms === ms && !t.cancelled);
    for (const t of due) await t.fn();
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

test('the reassurance line repeats every repeatMs, each followed by a resume', async () => {
  const h = harness();
  start(h);
  await h.runMs(10000); // first line at delayMs
  await h.runMs(15000); // repeat at repeatMs
  const texts = h.sent.filter((m) => m.type === 'text');
  const plays = h.sent.filter((m) => m.type === 'play');
  assert.equal(texts.length, 2); // spoken twice
  for (const t of texts) assert.equal(t.token, `[es] ${h.config.message}`);
  assert.equal(plays.length, 3); // initial + a resume after each line
});

test('clearHoldMusic stops further repeats', async () => {
  const h = harness();
  start(h);
  await h.runMs(10000); // first line, schedules the next repeat
  clearHoldMusic(h.party, h.timers);
  await h.runMs(15000); // would have repeated — but it's cancelled
  assert.equal(h.sent.filter((m) => m.type === 'text').length, 1);
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

test('malformed numeric env falls back to default delays', () => {
  const config = holdMusicConfig({ HOLD_MUSIC_DELAY_MS: 'abc', HOLD_TIMEOUT_MS: 'xyz' });
  assert.equal(config.delayMs, 10000);
  assert.equal(config.timeoutMs, 45000);
});

test('a failing translate falls back to the English line (never silent)', async () => {
  const h = harness({ translate: async () => { throw new Error('translate down'); } });
  start(h);
  await h.runMs(10000);
  assert.equal(h.sent[1].token, h.config.message); // untranslated English, not missing
});

test('clearHoldMusic cancels pending line and timeout timers', async () => {
  const h = harness();
  start(h);
  clearHoldMusic(h.party, h.timers);
  await h.runMs(10000);
  await h.runMs(45000);
  assert.equal(h.sent.length, 1); // only the initial play ever fired
});
