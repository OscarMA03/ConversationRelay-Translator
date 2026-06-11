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
  // Caller speaks/hears Spanish, agent speaks/hears English
  assert.deepEqual(COMBOS.map((c) => c.callerVoice), ['Lupe-Generative', 'Lupe-Neural', 'Lupe']);
  assert.deepEqual(COMBOS.map((c) => c.agentVoice), ['Matthew-Generative', 'Matthew-Neural', 'Matthew']);
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
