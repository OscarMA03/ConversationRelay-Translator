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

test('matrix covers the Polly tiers plus ElevenLabs Flash with Deepgram STT pinned', () => {
  assert.equal(COMBOS.length, 4);
  for (const combo of COMBOS) {
    assert.equal(combo.transcriptionProvider, 'Deepgram');
    assert.equal(combo.speechModel, 'nova-3-general');
  }
  assert.deepEqual(COMBOS.map((c) => c.ttsProvider), ['Amazon', 'Amazon', 'Amazon', 'ElevenLabs']);
  // Caller speaks/hears Spanish, agent speaks/hears English
  assert.deepEqual(COMBOS.map((c) => c.callerVoice), [
    'Lupe-Generative', 'Lupe-Neural', 'Lupe', 'CaJslL1xziwefCeTNzHv-flash_v2_5'
  ]);
  assert.deepEqual(COMBOS.map((c) => c.agentVoice), [
    'Matthew-Generative', 'Matthew-Neural', 'Matthew', 'UgBBYS2sOqTuMpoF3BR0-flash_v2_5'
  ]);
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
    [nextCombo().id, nextCombo().id, nextCombo().id, nextCombo().id, nextCombo().id],
    [1, 2, 3, 4, 1]
  );
});

test('TEST_COMBO pins rotation to one combo', (t) => {
  stubEnv(t, { TEST_COMBO: '3' });
  resetRotation();
  t.after(resetRotation);
  assert.equal(nextCombo().id, 3);
  assert.equal(nextCombo().id, 3);
});
