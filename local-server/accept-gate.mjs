// The agent accept-gate. When the agent endpoint is an ACD/queue (e.g. Webex)
// the outbound agent call is auto-answered into the queue before a human is
// present, so "answered" does not mean "ready". This module holds the caller
// and defers bridging until a real human signals readiness — in-band via a DTMF
// keypress on the agent leg (self-correlating: the keypress arrives on the very
// connection already linked to its caller), or out-of-band via HTTP.
//
// Extracted from server.mjs so the gate logic can be unit-tested with injected
// fakes (send/timers/translate), mirroring the dependency-injection style of
// hold-music.mjs. server.mjs wires the real dependencies in once at startup.

import { normalizePhone } from './session-registry.mjs';

/** Read accept-gate config from env once (overridable for tests). */
export function acceptGateConfig(env = process.env) {
  return {
    // With an ACD/queue agent endpoint, require the human to press a key to accept.
    enabled: env.AGENT_ACCEPT_DTMF === 'true',
    digit: env.AGENT_ACCEPT_DIGIT || '1',
    repeatMs: Number(env.AGENT_ACCEPT_REPEAT_MS) || 15000,
  };
}

// Turn a phone number into something TTS reads digit-by-digit, e.g.
// "+16195764744" -> "6 1 9, 5 7 6, 4 7 4 4". Returns '' if no number.
export function spokenPhone(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (!digits) return '';
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  const group = (s) => s.split('').join(' ');
  if (local.length === 10) {
    return `${group(local.slice(0, 3))}, ${group(local.slice(3, 6))}, ${group(local.slice(6))}`;
  }
  return group(local);
}

/**
 * Build an accept-gate bound to its side-effecting dependencies.
 *
 * @param connections      Map<connectionId, party> of live legs (shared with server)
 * @param send             sendWs-style (ws, payload) => void
 * @param clearHoldMusic   stop the caller's hold music: (party) => void
 * @param activateSession  mark the shared session activated: (from, info) => void
 * @param localize         (text, languageCode) => Promise<string> (localizedGreeting)
 * @param config           defaults to acceptGateConfig()
 * @param timers           setTimeout/clearTimeout (injectable for tests)
 * @param log              optional logger (...args) => void
 */
export function createAcceptGate({
  connections,
  send,
  clearHoldMusic,
  activateSession,
  localize,
  config = acceptGateConfig(),
  timers = { setTimeout, clearTimeout },
  log = () => {},
} = {}) {
  function clearAgentWhisper(agentParty) {
    if (agentParty?.whisperTimer) {
      timers.clearTimeout(agentParty.whisperTimer);
      agentParty.whisperTimer = null;
    }
  }

  // Link the caller and agent legs: activate translation both ways, stop the
  // caller's hold music, and announce the session. Used both when bridging
  // immediately (no accept gate) and when the agent accepts.
  function bridgeLegs(agentParty, caller) {
    caller.translationActive = true;
    caller.onHold = false;
    caller.targetConnectionId = agentParty.pk;
    caller.targetLanguageCode = agentParty.sourceLanguageCode;
    caller.targetLanguage = agentParty.sourceLanguage;
    caller.targetTranscriptionProvider = agentParty.sourceTranscriptionProvider;
    caller.targetTtsProvider = agentParty.sourceTtsProvider;
    caller.targetVoice = agentParty.sourceVoice;
    caller.targetCallSid = agentParty.callSid;

    agentParty.translationActive = true;
    agentParty.awaitingAccept = false;
    agentParty.targetConnectionId = caller.pk;

    clearHoldMusic(caller);
    clearAgentWhisper(agentParty);
    // Mark the shared session activated so either flow can see it's connected.
    activateSession(caller.From, { callerConnectionId: caller.pk, agentConnectionId: agentParty.pk });
    send(caller.ws, { type: 'text', token: 'The translation session has begun.', last: true });
    send(agentParty.ws, { type: 'text', token: 'The translation session has begun.', last: true });
  }

  // Find an agent leg that is awaiting accept whose caller's number matches `ani`.
  // There can be hundreds of concurrent sessions; we match on the caller leg's
  // From and, if more than one matches (same-number collision), take the most
  // recent still-waiting one (connections preserves insertion order).
  function findAwaitingByAni(ani) {
    const key = normalizePhone(ani);
    if (!key) return null;
    let match = null;
    for (const party of connections.values()) {
      if (party.whichParty !== 'callee' || !party.awaitingAccept) continue;
      const caller = connections.get(party.targetConnectionId);
      if (!caller || normalizePhone(caller.From) !== key) continue;
      match = { agentParty: party, caller };
    }
    return match;
  }

  // Every agent leg currently awaiting accept, paired with its caller. Used by the
  // HTTP accept when no number is given — safe to bridge only if there's exactly one.
  function listAwaiting() {
    const out = [];
    for (const party of connections.values()) {
      if (party.whichParty !== 'callee' || !party.awaitingAccept) continue;
      const caller = connections.get(party.targetConnectionId);
      if (caller) out.push({ agentParty: party, caller });
    }
    return out;
  }

  // Repeatedly prompt the agent leg to press the accept key, announcing the
  // caller's number. Repeats because a human joins the queued call late and must
  // hear the prompt (and the number) when they arrive. The number is built from
  // digits and spliced in after translation so the translator can't mangle it.
  async function startAgentWhisper(agentParty) {
    const digit = config.digit;
    const lang = agentParty.sourceLanguageCode;
    const number = spokenPhone(agentParty.callerPhone);
    const action = await localize(`Press ${digit} to connect.`, lang);
    const text = number
      ? `${await localize('Incoming translated call from', lang)} ${number}. ${action}`
      : `${await localize('You have a translated call waiting.', lang)} ${action}`;
    const whisper = () => {
      if (!agentParty.awaitingAccept) return;
      send(agentParty.ws, { type: 'text', token: text, last: true });
      agentParty.whisperTimer = timers.setTimeout(whisper, config.repeatMs);
    };
    whisper();
  }

  // Called when the agent (callee) leg connects. With an ACD/queue the call is
  // auto-answered before a human is present, so when the gate is enabled we don't
  // bridge on "answered" — mark the leg awaiting accept and whisper for a keypress,
  // leaving the caller on hold music. With the gate disabled (e.g. direct-dial
  // agent), bridge immediately.
  async function onAgentConnected(agentParty, caller) {
    if (config.enabled) {
      agentParty.awaitingAccept = true;
      log('agent leg connected — awaiting DTMF accept', { connectionId: agentParty.pk, callerId: caller.pk });
      await startAgentWhisper(agentParty);
      return;
    }
    bridgeLegs(agentParty, caller);
  }

  // The human agent pressed a key. If it's the accept key and this leg is waiting,
  // bridge the call (stops the caller's hold music and starts translation).
  function handleDtmf(connectionId, body) {
    const party = connections.get(connectionId);
    if (!party) return;
    const digit = String(body.digit ?? body.digits ?? '');
    log('dtmf', { connectionId, whichParty: party.whichParty, digit });
    if (!party.awaitingAccept) return;
    if (digit !== config.digit) return;

    const caller = connections.get(party.targetConnectionId);
    if (!caller) {
      send(party.ws, { type: 'text', token: 'Could not find the caller leg to connect.', last: true });
      return;
    }
    log('agent accepted call', { connectionId, callerId: caller.pk });
    bridgeLegs(party, caller);
  }

  return {
    config,
    bridgeLegs,
    clearAgentWhisper,
    findAwaitingByAni,
    listAwaiting,
    startAgentWhisper,
    onAgentConnected,
    handleDtmf,
  };
}
