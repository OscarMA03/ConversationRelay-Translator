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
