import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createAcceptGate, acceptGateConfig, spokenPhone } from './accept-gate.mjs';

// Builds a gate wired to fakes: `send` records (ws,payload); `clearHoldMusic` and
// `activateSession` record their calls; `localize` is identity (English path);
// manual timers let a test fire the repeating whisper deterministically.
function harness({ config, env } = {}) {
  const connections = new Map();
  const sent = [];
  const send = (ws, payload) => sent.push({ ws, payload });
  const cleared = [];
  const clearHoldMusic = (party) => cleared.push(party);
  const activations = [];
  const activateSession = (from, info) => activations.push({ from, info });
  const localize = async (text) => text; // identity — exercises the en passthrough shape
  const scheduled = [];
  const timers = {
    setTimeout: (fn, ms) => { const t = { fn, ms, cancelled: false }; scheduled.push(t); return t; },
    clearTimeout: (t) => { if (t) t.cancelled = true; },
  };
  const gate = createAcceptGate({
    connections,
    send,
    clearHoldMusic,
    activateSession,
    localize,
    config: config ?? acceptGateConfig(env ?? {}),
    timers,
    log: () => {},
  });
  // Fire any pending, not-yet-cancelled timer whose `fn` is the whisper re-arm.
  const fireTimers = () => {
    for (const t of [...scheduled]) {
      if (!t.cancelled && !t.fired) { t.fired = true; t.fn(); }
    }
  };
  return { connections, sent, cleared, activations, scheduled, timers, gate, fireTimers };
}

// Add a linked caller+agent pair to `connections`. The agent leg starts awaiting.
function addPair(connections, { id, from = '+16195764744', callerPhone = from, awaiting = true } = {}) {
  const caller = {
    pk: `caller-${id}`, whichParty: 'caller', ws: { tag: `caller-${id}` },
    From: from, onHold: true, sourceLanguageCode: 'es', sourceLanguage: 'es-MX',
  };
  const agent = {
    pk: `agent-${id}`, whichParty: 'callee', ws: { tag: `agent-${id}` },
    awaitingAccept: awaiting, targetConnectionId: caller.pk, callerPhone,
    sourceLanguageCode: 'en', sourceLanguage: 'en-US',
    sourceTranscriptionProvider: 'p', sourceTtsProvider: 't', sourceVoice: 'v', callSid: `CA-${id}`,
  };
  connections.set(caller.pk, caller);
  connections.set(agent.pk, agent);
  return { caller, agent };
}

const tokensTo = (sent, ws) => sent.filter((m) => m.ws === ws).map((m) => m.payload);

// --- 2.1 gate defers vs bridges immediately ---------------------------------

test('gate enabled: onAgentConnected defers the bridge and marks awaiting accept', async () => {
  const h = harness({ env: { AGENT_ACCEPT_DTMF: 'true' } });
  const { caller, agent } = addPair(h.connections, { id: 1, awaiting: false });

  await h.gate.onAgentConnected(agent, caller);

  assert.equal(agent.awaitingAccept, true);
  assert.equal(caller.onHold, true, 'caller stays on hold — not bridged');
  assert.equal(caller.translationActive, undefined, 'translation not started');
  assert.equal(h.activations.length, 0, 'session not activated');
  // The whisper was started (a prompt was sent to the agent leg).
  assert.ok(tokensTo(h.sent, agent.ws).length >= 1, 'agent heard the whisper');
});

test('gate disabled: onAgentConnected bridges immediately', async () => {
  const h = harness({ env: {} }); // AGENT_ACCEPT_DTMF unset -> disabled
  const { caller, agent } = addPair(h.connections, { id: 1, awaiting: false });

  await h.gate.onAgentConnected(agent, caller);

  assert.equal(caller.translationActive, true);
  assert.equal(agent.translationActive, true);
  assert.equal(caller.onHold, false);
  assert.equal(h.activations.length, 1, 'session activated on bridge');
  assert.deepEqual(h.cleared, [caller], 'hold music cleared');
});

// --- 2.2 accept digit bridges the correct caller; bad input ignored ---------

test('handleDtmf with the accept digit bridges the linked caller', () => {
  const h = harness({ env: { AGENT_ACCEPT_DTMF: 'true' } });
  const { caller, agent } = addPair(h.connections, { id: 1 });

  h.gate.handleDtmf(agent.pk, { digit: '1' });

  assert.equal(caller.translationActive, true);
  assert.equal(agent.awaitingAccept, false);
  assert.equal(caller.targetConnectionId, agent.pk);
  assert.equal(agent.targetConnectionId, caller.pk);
  assert.deepEqual(h.activations[0], {
    from: caller.From, info: { callerConnectionId: caller.pk, agentConnectionId: agent.pk },
  });
});

test('handleDtmf ignores a non-accept digit', () => {
  const h = harness({ env: { AGENT_ACCEPT_DTMF: 'true' } });
  const { caller, agent } = addPair(h.connections, { id: 1 });

  h.gate.handleDtmf(agent.pk, { digit: '9' });

  assert.equal(agent.awaitingAccept, true, 'still waiting');
  assert.equal(caller.translationActive, undefined, 'not bridged');
});

test('handleDtmf ignores a keypress on a leg that is not awaiting accept', () => {
  const h = harness({ env: { AGENT_ACCEPT_DTMF: 'true' } });
  const { caller, agent } = addPair(h.connections, { id: 1, awaiting: false });

  h.gate.handleDtmf(agent.pk, { digit: '1' });

  assert.equal(caller.translationActive, undefined, 'not bridged');
  assert.equal(h.activations.length, 0);
});

test('handleDtmf honours a custom accept digit', () => {
  const h = harness({ env: { AGENT_ACCEPT_DTMF: 'true', AGENT_ACCEPT_DIGIT: '5' } });
  const { caller, agent } = addPair(h.connections, { id: 1 });

  h.gate.handleDtmf(agent.pk, { digit: '1' });
  assert.equal(caller.translationActive, undefined, '1 is not the accept digit now');

  h.gate.handleDtmf(agent.pk, { digit: '5' });
  assert.equal(caller.translationActive, true, '5 accepts');
});

// --- 2.3 concurrent awaiting legs do not collide ----------------------------

test('two concurrent accepts each bridge only their own caller', () => {
  const h = harness({ env: { AGENT_ACCEPT_DTMF: 'true' } });
  const a = addPair(h.connections, { id: 'A', from: '+16190000001' });
  const b = addPair(h.connections, { id: 'B', from: '+16190000002' });

  h.gate.handleDtmf(a.agent.pk, { digit: '1' });

  assert.equal(a.caller.translationActive, true, 'A bridged');
  assert.equal(b.caller.translationActive, undefined, 'B untouched');
  assert.equal(b.agent.awaitingAccept, true, 'B still waiting');

  h.gate.handleDtmf(b.agent.pk, { digit: '1' });

  assert.equal(b.caller.translationActive, true, 'B now bridged to its own caller');
  assert.equal(b.caller.targetConnectionId, b.agent.pk);
  assert.equal(a.caller.targetConnectionId, a.agent.pk, 'A unchanged by B accept');
});

// --- 2.4 whisper text with/without number, stops on accept ------------------

test('whisper announces the caller number digit-by-digit', async () => {
  const h = harness({ env: { AGENT_ACCEPT_DTMF: 'true' } });
  const { agent } = addPair(h.connections, { id: 1, callerPhone: '+16195764744' });

  await h.gate.startAgentWhisper(agent);

  const token = tokensTo(h.sent, agent.ws)[0].token;
  assert.match(token, /Incoming translated call from 6 1 9, 5 7 6, 4 7 4 4\./);
  assert.match(token, /Press 1 to connect\./);
});

test('whisper without a known number uses the generic line', async () => {
  const h = harness({ env: { AGENT_ACCEPT_DTMF: 'true' } });
  const { agent } = addPair(h.connections, { id: 1, callerPhone: '' });

  await h.gate.startAgentWhisper(agent);

  const token = tokensTo(h.sent, agent.ws)[0].token;
  assert.match(token, /You have a translated call waiting\. Press 1 to connect\./);
});

test('whisper repeats while awaiting and stops once not awaiting', async () => {
  const h = harness({ env: { AGENT_ACCEPT_DTMF: 'true' } });
  const { agent } = addPair(h.connections, { id: 1 });

  await h.gate.startAgentWhisper(agent);
  assert.equal(tokensTo(h.sent, agent.ws).length, 1, 'spoke once immediately');

  h.fireTimers(); // re-arm fires -> speaks again
  assert.equal(tokensTo(h.sent, agent.ws).length, 2, 'repeated');

  agent.awaitingAccept = false; // accepted/gone
  h.scheduled.forEach((t) => (t.fired = false)); // allow the last re-armed timer to fire
  h.fireTimers();
  assert.equal(tokensTo(h.sent, agent.ws).length, 2, 'no further whisper after accept');
});

test('clearAgentWhisper cancels the pending repeat', async () => {
  const h = harness({ env: { AGENT_ACCEPT_DTMF: 'true' } });
  const { agent } = addPair(h.connections, { id: 1 });

  await h.gate.startAgentWhisper(agent);
  assert.ok(agent.whisperTimer, 'a repeat is scheduled');
  h.gate.clearAgentWhisper(agent);
  assert.equal(agent.whisperTimer, null, 'timer handle cleared');
});

// --- 2.5 awaiting-lookup decision logic behind /v1/call-answered ------------

test('findAwaitingByAni matches the awaiting leg for that caller number', () => {
  const h = harness({ env: { AGENT_ACCEPT_DTMF: 'true' } });
  addPair(h.connections, { id: 'A', from: '+16190000001' });
  const b = addPair(h.connections, { id: 'B', from: '+16190000002' });

  const match = h.gate.findAwaitingByAni('(619) 000-0002');
  assert.equal(match.agentParty, b.agent, 'matched by normalized number');
  assert.equal(match.caller, b.caller);
});

test('findAwaitingByAni returns null when no awaiting leg matches', () => {
  const h = harness({ env: { AGENT_ACCEPT_DTMF: 'true' } });
  addPair(h.connections, { id: 'A', from: '+16190000001' });

  assert.equal(h.gate.findAwaitingByAni('+19998887777'), null);
});

test('listAwaiting reflects exactly the legs still awaiting', () => {
  const h = harness({ env: { AGENT_ACCEPT_DTMF: 'true' } });
  const a = addPair(h.connections, { id: 'A', from: '+16190000001' });
  addPair(h.connections, { id: 'B', from: '+16190000002' });

  assert.equal(h.gate.listAwaiting().length, 2, 'two awaiting');

  h.gate.handleDtmf(a.agent.pk, { digit: '1' }); // accept A
  const remaining = h.gate.listAwaiting();
  assert.equal(remaining.length, 1, 'one left after an accept');
  assert.equal(remaining[0].caller.From, '+16190000002');
});

// --- pure helper -------------------------------------------------------------

test('spokenPhone groups a US number for digit-by-digit TTS', () => {
  assert.equal(spokenPhone('+16195764744'), '6 1 9, 5 7 6, 4 7 4 4');
  assert.equal(spokenPhone(''), '');
  assert.equal(spokenPhone(null), '');
});
