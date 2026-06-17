import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSessionRegistry, normalizePhone, toE164, toDisplay } from './session-registry.mjs';

test('toE164 and toDisplay format US numbers', () => {
  assert.equal(toE164('+16195764744'), '+16195764744');
  assert.equal(toE164('6195764744'), '+16195764744');
  assert.equal(toE164('(619) 576-4744'), '+16195764744');
  assert.equal(toE164(''), '');
  assert.equal(toDisplay('+16195764744'), '(619) 576-4744');
  assert.equal(toDisplay('6195764744'), '(619) 576-4744');
  assert.equal(toDisplay(''), '');
});

test('register includes E164 and display forms', () => {
  const reg = createSessionRegistry();
  const entry = reg.register({ callerAni: ' 16195764744' }); // leading-space (the +→space quirk)
  assert.equal(entry.callerAniE164, '+16195764744');
  assert.equal(entry.callerAniDisplay, '(619) 576-4744');
});

test('normalizePhone canonicalizes formats', () => {
  assert.equal(normalizePhone('+16195764744'), '6195764744');
  assert.equal(normalizePhone('6195764744'), '6195764744');
  assert.equal(normalizePhone('(619) 576-4744'), '6195764744');
  assert.equal(normalizePhone(''), '');
  assert.equal(normalizePhone(undefined), '');
});

test('register creates a waiting entry and get finds it by any format', () => {
  const reg = createSessionRegistry();
  const entry = reg.register({ callerAni: '+16195764744', id: 'flow-abc' });
  assert.equal(entry.status, 'waiting');
  assert.equal(entry.id, 'flow-abc');
  assert.equal(reg.get('6195764744').callerAni, '+16195764744');
  assert.equal(reg.isActivated('+16195764744'), false);
});

test('register without a usable number returns null', () => {
  const reg = createSessionRegistry();
  assert.equal(reg.register({ callerAni: '' }), null);
  assert.equal(reg.register({}), null);
});

test('activate flips status and records activatedAt', () => {
  let t = 1000;
  const reg = createSessionRegistry({ now: () => t });
  reg.register({ callerAni: '6195764744' });
  t = 5000;
  const entry = reg.activate('+1 619 576 4744', { agentConnectionId: 'agent-1' });
  assert.equal(entry.status, 'activated');
  assert.equal(entry.activatedAt, 5000);
  assert.equal(entry.agentConnectionId, 'agent-1');
  assert.equal(reg.isActivated('6195764744'), true);
});

test('activate on an unknown number returns null', () => {
  const reg = createSessionRegistry();
  assert.equal(reg.activate('+15550001111'), null);
});

test('re-register after activation starts a fresh waiting call (same number reused)', () => {
  let t = 1000;
  const reg = createSessionRegistry({ now: () => t });
  reg.register({ callerAni: '6195764744' });
  reg.activate('6195764744');
  t = 2000;
  const entry = reg.register({ callerAni: '6195764744', id: 'new-call' });
  assert.equal(entry.status, 'waiting');   // reset — it's a new call, not the old one
  assert.equal(entry.createdAt, 2000);     // fresh wait-start
  assert.equal(entry.activatedAt, null);   // cleared
  assert.equal(entry.id, 'new-call');
});

test('re-register while still waiting keeps the original createdAt', () => {
  let t = 1000;
  const reg = createSessionRegistry({ now: () => t });
  reg.register({ callerAni: '6195764744' });
  t = 1500;
  const entry = reg.register({ callerAni: '6195764744', id: 'add-id' });
  assert.equal(entry.status, 'waiting');
  assert.equal(entry.createdAt, 1000);     // preserved — same call, FIFO intact
  assert.equal(entry.id, 'add-id');
});

test('entries expire after the TTL', () => {
  let t = 0;
  const reg = createSessionRegistry({ ttlMs: 1000, now: () => t });
  reg.register({ callerAni: '6195764744' });
  t = 999;
  assert.ok(reg.get('6195764744'));
  t = 1001;
  assert.equal(reg.get('6195764744'), null); // pruned
});

test('oldestWaiting returns the earliest-registered waiting entry (FIFO)', () => {
  let t = 1000;
  const reg = createSessionRegistry({ now: () => t });
  reg.register({ callerAni: '6190000001' }); // oldest
  t = 2000;
  reg.register({ callerAni: '6190000002' });
  t = 3000;
  reg.register({ callerAni: '6190000003' });
  assert.equal(reg.oldestWaiting().callerAni, '6190000001');
});

test('oldestWaiting with claim hands out each caller once, in order', () => {
  let t = 1000;
  const reg = createSessionRegistry({ now: () => t });
  reg.register({ callerAni: '6190000001' });
  t = 2000;
  reg.register({ callerAni: '6190000002' });
  t = 3000;
  assert.equal(reg.oldestWaiting({ claim: true }).callerAni, '6190000001');
  assert.equal(reg.oldestWaiting({ claim: true }).callerAni, '6190000002'); // next one
  assert.equal(reg.oldestWaiting({ claim: true }), null); // none left waiting
});

test('oldestWaiting skips already-activated calls', () => {
  let t = 1000;
  const reg = createSessionRegistry({ now: () => t });
  reg.register({ callerAni: '6190000001' });
  t = 2000;
  reg.register({ callerAni: '6190000002' });
  reg.activate('6190000001'); // first one is connected, no longer waiting
  assert.equal(reg.oldestWaiting().callerAni, '6190000002');
});

test('remove deletes an entry', () => {
  const reg = createSessionRegistry();
  reg.register({ callerAni: '6195764744' });
  assert.equal(reg.remove('+16195764744'), true);
  assert.equal(reg.get('6195764744'), null);
});
