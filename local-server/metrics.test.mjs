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
