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
  // Fire every timer currently scheduled for exactly `ms` that hasn't already
  // fired or been cancelled. Snapshot + `fired` flag model real one-shot timers,
  // so re-arming a timer at the same `ms` (the repeating cycle) works correctly.
  const runMs = async (ms) => {
    const due = scheduled.filter((t) => t.ms === ms && !t.cancelled && !t.fired);
    for (const t of due) { t.fired = true; await t.fn(); }
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

test('at the delay it speaks the line, then resumes music after the line pause', async () => {
  const h = harness();
  start(h);
  await h.runMs(10000); // line plays — music NOT resumed yet
  assert.deepEqual(h.sent.slice(1), [{
    type: 'text',
    token: `[es] ${h.config.message}`,
    last: true,
    preemptible: false,
    interruptible: false,
  }]);
  await h.runMs(7000); // line pause elapses — now resume music
  assert.deepEqual(h.sent.slice(2), [{
    type: 'play',
    source: COWBELL,
    loop: 0,
    preemptible: true,
    interruptible: false,
  }]);
});

test('the line/music cycle repeats: line, pause, resume, repeat', async () => {
  const h = harness();
  start(h);
  await h.runMs(10000); // line 1
  await h.runMs(7000);  // resume music 1, schedules line 2 at repeatMs
  await h.runMs(15000); // line 2
  await h.runMs(7000);  // resume music 2
  const texts = h.sent.filter((m) => m.type === 'text');
  const plays = h.sent.filter((m) => m.type === 'play');
  assert.equal(texts.length, 2); // spoken twice
  for (const t of texts) assert.equal(t.token, `[es] ${h.config.message}`);
  assert.equal(plays.length, 3); // initial + a resume after each line
});

test('clearHoldMusic stops the cycle (no resume, no further lines)', async () => {
  const h = harness();
  start(h);
  await h.runMs(10000); // line 1, schedules the resume
  clearHoldMusic(h.party, h.timers);
  await h.runMs(7000);  // resume would fire — but it's cancelled
  await h.runMs(15000); // next line would fire — but it's cancelled
  assert.equal(h.sent.filter((m) => m.type === 'text').length, 1);
  assert.equal(h.sent.filter((m) => m.type === 'play').length, 1); // only the initial
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
