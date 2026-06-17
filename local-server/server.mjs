import 'dotenv/config';

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import { WebSocketServer } from 'ws';

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getCombo, nextCombo } from './combos.mjs';
import { parseEvents, summarize } from './metrics.mjs';
import { translateText } from './providers.mjs';
import { startHoldMusic, clearHoldMusic, holdMusicConfig } from './hold-music.mjs';

const port = Number(process.env.PORT ?? 3000);

/** @type {Map<string, Record<string, any>>} */
const connections = new Map();
/** @type {Array<Record<string, any>>} */
const transcript = [];
/** Last few inbound webhook payloads, newest first — for correlation-key research. */
const inboundPayloads = [];

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

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function getPublicBaseUrl(req) {
  const configured = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '');
  if (configured) return configured;

  const proto = req.headers['x-forwarded-proto'] ?? 'https';
  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  return `${proto}://${host}`;
}

function getWsUrl(req) {
  if (process.env.WS_URL) return process.env.WS_URL;
  const publicBaseUrl = getPublicBaseUrl(req);
  return publicBaseUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:') + '/ws';
}

function callerContext(params = {}, combo = null) {
  return {
    name: process.env.CALLER_NAME ?? 'Caller',
    sourceLanguageCode: process.env.CALLER_TRANSLATE_CODE ?? 'en',
    sourceLanguage: process.env.CALLER_LANGUAGE ?? 'en-US',
    sourceLanguageFriendly: process.env.CALLER_LANGUAGE_FRIENDLY ?? 'English - United States',
    sourceTranscriptionProvider: combo?.transcriptionProvider ?? process.env.CALLER_TRANSCRIPTION_PROVIDER ?? 'Deepgram',
    sourceTtsProvider: combo?.ttsProvider ?? process.env.CALLER_TTS_PROVIDER ?? 'Amazon',
    sourceVoice: combo?.callerVoice ?? process.env.CALLER_VOICE ?? 'Matthew-Generative',
    To: params.To ?? process.env.TWILIO_DEFAULT_FROM ?? '',
    From: params.From ?? '',
    SortKey: params.From ?? '',
    AccountSid: params.AccountSid ?? process.env.TWILIO_ACCOUNT_SID ?? '',
    SourceCallSid: params.CallSid ?? '',
    translationActive: false,
    whichParty: 'caller',
    targetConnectionId: 'notset',
    targetLanguageCode: 'notset',
    targetLanguage: 'notset',
    targetTranscriptionProvider: 'notset',
    targetTtsProvider: 'notset',
    targetVoice: 'notset',
    targetCallSid: 'notset',
    ...(combo ? { testComboId: combo.id } : {})
  };
}

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

function buildParameterXml(params) {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([name, value]) => `      <Parameter name="${escapeXml(name)}" value="${escapeXml(value)}" />`)
    .join('\n');
}

function buildConversationRelayTwiml({ wsUrl, relay, params }) {
  const relayAttrs = Object.entries(relay)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([name, value]) => `${escapeXml(name)}="${escapeXml(value)}"`)
    .join(' ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay url="${escapeXml(wsUrl)}" ${relayAttrs}>
${buildParameterXml(params)}
    </ConversationRelay>
  </Connect>
</Response>`;
}

async function localizedGreeting(greeting, languageCode) {
  if (!languageCode || languageCode === 'en' || languageCode.startsWith('en-')) return greeting;
  return translateText(greeting, 'en', languageCode);
}

async function inboundTwiml(req, twilioParams) {
  const combo = isTestMode() ? nextCombo() : null;
  const context = callerContext(twilioParams, combo);
  if (combo) log('test mode combo', { id: combo.id, label: combo.label });
  const greeting = combo
    ? `Test combo ${combo.id}: ${combo.label}. Please wait while we connect you to a translator.`
    : 'Please wait while we connect you to a translator.';
  return buildConversationRelayTwiml({
    wsUrl: getWsUrl(req),
    relay: {
      welcomeGreeting: await localizedGreeting(greeting, context.sourceLanguageCode),
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

async function outboundAgentTwiml(callerParty) {
  const combo = isTestMode() && callerParty.testComboId ? getCombo(callerParty.testComboId) : null;
  const context = agentContext(combo);
  const params = {
    ...context,
    ...(combo ? { testComboId: combo.id } : {}),
    To: process.env.AGENT_PHONE_NUMBER,
    From: callerParty.To,
    SortKey: callerParty.To,
    AccountSid: callerParty.AccountSid,
    parentConnectionId: callerParty.pk,
    translationActive: true,
    whichParty: 'callee',
    callerPhone: callerParty.From,
    targetConnectionId: callerParty.pk,
    targetLanguageCode: callerParty.sourceLanguageCode,
    targetLanguage: callerParty.sourceLanguage,
    targetTranscriptionProvider: callerParty.sourceTranscriptionProvider,
    targetTtsProvider: callerParty.sourceTtsProvider,
    targetVoice: callerParty.sourceVoice,
    targetCallSid: callerParty.callSid
  };

  return buildConversationRelayTwiml({
    wsUrl: (process.env.WS_URL || `${process.env.PUBLIC_BASE_URL?.replace(/\/$/, '')}/ws`)
      .replace(/^https:/, 'wss:')
      .replace(/^http:/, 'ws:'),
    relay: {
      welcomeGreeting: await localizedGreeting('Initiating translation session.', context.sourceLanguageCode),
      dtmfDetection: process.env.AGENT_ACCEPT_DTMF === 'true' ? 'true' : 'false',
      interruptByDtmf: 'false',
      language: context.sourceLanguage,
      transcriptionProvider: context.sourceTranscriptionProvider,
      ...(combo ? { speechModel: combo.speechModel } : {}),
      ttsProvider: context.sourceTtsProvider,
      voice: context.sourceVoice
    },
    params
  });
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function parseTwilioRequest(req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const params = Object.fromEntries(url.searchParams.entries());

  if (req.method === 'POST') {
    const body = await readRequestBody(req);
    const contentType = req.headers['content-type'] ?? '';
    if (contentType.includes('application/x-www-form-urlencoded')) {
      Object.assign(params, Object.fromEntries(new URLSearchParams(body).entries()));
    } else if (contentType.includes('application/json') && body) {
      Object.assign(params, JSON.parse(body));
    }
  }

  return params;
}

function send(res, statusCode, body, contentType = 'text/plain') {
  res.writeHead(statusCode, { 'Content-Type': contentType });
  res.end(body);
}

function sendWs(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

async function createTwilioCall({ to, from, twiml }) {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token } = process.env;
  if (!sid || !token) throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required');

  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ To: to, From: from, Twiml: twiml })
  });

  const json = await response.json();
  if (!response.ok) {
    throw new Error(`Twilio call failed (${response.status}): ${JSON.stringify(json)}`);
  }
  return json;
}

async function maybeDialAgent(callerParty) {
  if (process.env.AUTO_DIAL_AGENT !== 'true') {
    sendWs(callerParty.ws, {
      type: 'text',
      token: 'Caller leg connected. Set AUTO_DIAL_AGENT=true to dial the second party automatically.',
      last: true
    });
    return;
  }

  if (!process.env.PUBLIC_BASE_URL && !process.env.WS_URL) {
    throw new Error('PUBLIC_BASE_URL or WS_URL is required for outbound agent calls');
  }
  if (!process.env.AGENT_PHONE_NUMBER) {
    throw new Error('AGENT_PHONE_NUMBER is required for outbound agent calls');
  }

  const from = callerParty.To || process.env.TWILIO_DEFAULT_FROM;
  const twiml = await outboundAgentTwiml(callerParty);
  const call = await createTwilioCall({ to: process.env.AGENT_PHONE_NUMBER, from, twiml });
  callerParty.targetCallSid = call.sid;
  log('Dialed agent:', call.sid);
}

async function handleSetup(ws, connectionId, body) {
  const custom = body.customParameters ?? {};
  const parentConnectionId = custom.parentConnectionId || connectionId;
  const party = {
    ...custom,
    pk: connectionId,
    ws,
    callSid: body.callSid,
    direction: body.direction,
    callStatus: 'connected',
    parentConnectionId,
    translationActive: custom.translationActive === true || custom.translationActive === 'true'
  };
  party.testComboId = custom.testComboId ? Number(custom.testComboId) : undefined;

  connections.set(connectionId, party);
  log('setup', { connectionId, whichParty: party.whichParty, callSid: party.callSid });
  recordEvent({
    ts: Date.now(),
    sessionId: party.parentConnectionId,
    comboId: party.testComboId,
    leg: party.whichParty,
    direction: 'in',
    type: 'setup'
  });

  if (party.whichParty === 'caller') {
    await maybeDialAgent(party);
    if (process.env.AUTO_DIAL_AGENT === 'true') {
      // DIAGNOSTIC: log every hold-music message we send, with timestamp.
      const loggedSend = (target, payload) => {
        log('hold-music ->', party.pk, payload.type, payload.token ?? payload.source ?? '');
        sendWs(target, payload);
      };
      startHoldMusic(party, { send: loggedSend, translate: translateText });
      party.onHold = true;
    }
    return;
  }

  if (party.whichParty === 'callee') {
    const caller = connections.get(party.targetConnectionId);
    if (!caller) {
      sendWs(ws, { type: 'text', token: 'Could not find the caller leg for this translation session.', last: true });
      return;
    }

    // With an ACD/queue (e.g. Webex) as the agent endpoint, the outbound call is
    // auto-answered into a queue before a human is present. So when the accept
    // gate is on, don't bridge on "answered" — wait for the human agent to press
    // the accept key (handleDtmf). The caller stays on hold music until then.
    if (process.env.AGENT_ACCEPT_DTMF === 'true') {
      party.awaitingAccept = true;
      log('agent leg connected — awaiting DTMF accept', { connectionId, callerId: caller.pk });
      await startAgentWhisper(party);
      return;
    }

    bridgeLegs(party, caller);
  }
}

// Link the caller and agent legs: activate translation both ways, stop the
// caller's hold music, and announce the session. Used both when bridging
// immediately (no accept gate) and when the agent accepts via DTMF.
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
  sendWs(caller.ws, { type: 'text', token: 'The translation session has begun.', last: true });
  sendWs(agentParty.ws, { type: 'text', token: 'The translation session has begun.', last: true });
}

const AGENT_WHISPER_REPEAT_MS = Number(process.env.AGENT_ACCEPT_REPEAT_MS) || 15000;

// Turn a phone number into something TTS reads digit-by-digit, e.g.
// "+16195764744" -> "6 1 9, 5 7 6, 4 7 4 4". Returns '' if no number.
function spokenPhone(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (!digits) return '';
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  const group = (s) => s.split('').join(' ');
  if (local.length === 10) {
    return `${group(local.slice(0, 3))}, ${group(local.slice(3, 6))}, ${group(local.slice(6))}`;
  }
  return group(local);
}

// Repeatedly prompt the agent leg to press the accept key, announcing the
// caller's number. Repeats because a human joins the queued call late and must
// hear the prompt (and the number) when they arrive. The number is built from
// digits and spliced in after translation so the translator can't mangle it.
async function startAgentWhisper(agentParty) {
  const digit = process.env.AGENT_ACCEPT_DIGIT || '1';
  const lang = agentParty.sourceLanguageCode;
  const number = spokenPhone(agentParty.callerPhone);
  const action = await localizedGreeting(`Press ${digit} to connect.`, lang);
  const text = number
    ? `${await localizedGreeting('Incoming translated call from', lang)} ${number}. ${action}`
    : `${await localizedGreeting('You have a translated call waiting.', lang)} ${action}`;
  const whisper = () => {
    if (!agentParty.awaitingAccept) return;
    sendWs(agentParty.ws, { type: 'text', token: text, last: true });
    agentParty.whisperTimer = setTimeout(whisper, AGENT_WHISPER_REPEAT_MS);
  };
  whisper();
}

function clearAgentWhisper(agentParty) {
  if (agentParty?.whisperTimer) {
    clearTimeout(agentParty.whisperTimer);
    agentParty.whisperTimer = null;
  }
}

// The human agent pressed a key. If it's the accept key and this leg is waiting,
// bridge the call (stops the caller's hold music and starts translation).
function handleDtmf(connectionId, body) {
  const party = connections.get(connectionId);
  if (!party) return;
  const digit = String(body.digit ?? body.digits ?? '');
  log('dtmf', { connectionId, whichParty: party.whichParty, digit });
  if (!party.awaitingAccept) return;
  if (digit !== (process.env.AGENT_ACCEPT_DIGIT || '1')) return;

  const caller = connections.get(party.targetConnectionId);
  if (!caller) {
    sendWs(party.ws, { type: 'text', token: 'Could not find the caller leg to connect.', last: true });
    return;
  }
  log('agent accepted call', { connectionId, callerId: caller.pk });
  bridgeLegs(party, caller);
}

async function handlePrompt(connectionId, body) {
  const party = connections.get(connectionId);
  if (!party) return;

  const text = body.voicePrompt ?? body.prompt ?? body.text ?? '';
  if (!text) return;

  // While the caller is on hold music, or the agent hasn't accepted yet, ignore
  // speech instead of replying with the "configuring translation" filler.
  if (party.onHold || party.awaitingAccept) return;

  recordEvent({
    ts: Date.now(),
    sessionId: party.parentConnectionId,
    comboId: party.testComboId,
    leg: party.whichParty,
    direction: 'in',
    type: 'prompt'
  });

  if (!party.translationActive || !party.targetConnectionId || party.targetConnectionId === 'notset') {
    sendWs(party.ws, {
      type: 'text',
      token: 'Please wait while we configure translation services.',
      last: true
    });
    return;
  }

  const target = connections.get(party.targetConnectionId);
  if (!target) {
    sendWs(party.ws, { type: 'text', token: 'The other party is not connected.', last: true });
    return;
  }

  const translated = await translateText(text, party.sourceLanguageCode, party.targetLanguageCode);
  log('translated prompt', {
    whichParty: party.whichParty,
    from: party.sourceLanguageCode,
    to: party.targetLanguageCode,
    original: text,
    translated
  });

  transcript.push({
    ts: Date.now(),
    session: party.parentConnectionId,
    whichParty: party.whichParty,
    original: text,
    originalLanguageCode: party.sourceLanguageCode,
    translated,
    translatedLanguageCode: party.targetLanguageCode
  });

  sendWs(target.ws, { type: 'text', token: translated, last: true });
  recordEvent({
    ts: Date.now(),
    sessionId: party.parentConnectionId,
    comboId: party.testComboId,
    leg: target.whichParty,
    direction: 'out',
    type: 'text',
    chars: translated.length
  });
}

function handleDisconnect(connectionId) {
  const party = connections.get(connectionId);
  if (!party) return;

  clearHoldMusic(party);
  clearAgentWhisper(party);

  party.callStatus = 'disconnected';
  connections.delete(connectionId);
  log('disconnect', { connectionId, whichParty: party.whichParty });

  const target = connections.get(party.targetConnectionId);
  if (target) {
    target.translationActive = false;
    // If the agent leg was still waiting to accept (e.g. caller hung up or timed
    // out on hold), stop whispering and hang that leg up too.
    if (target.awaitingAccept) {
      clearAgentWhisper(target);
      target.awaitingAccept = false;
      sendWs(target.ws, { type: 'end', handoffData: JSON.stringify({ reasonCode: 'caller-gone' }) });
    } else {
      sendWs(target.ws, { type: 'text', token: 'The other person has ended the call.', last: true });
    }
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/health') {
      send(res, 200, 'ok');
      return;
    }

    if (url.pathname === '/sessions') {
      send(res, 200, JSON.stringify({
        connections: [...connections.values()].map(({ ws, ...party }) => party),
        transcript
      }, null, 2), 'application/json');
      return;
    }

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

    if (url.pathname === '/twiml/inbound') {
      const params = await parseTwilioRequest(req);

      // Full payload dump for correlation-key research. SipHeader_* params only
      // appear when the call arrives via a Twilio SIP Domain (not plain PSTN).
      const sipHeaders = Object.fromEntries(
        Object.entries(params).filter(([k]) => k.startsWith('SipHeader_'))
      );
      log('INBOUND PAYLOAD ==>\n' + JSON.stringify(params, null, 2));
      log('INBOUND SIP HEADERS ==>', JSON.stringify(sipHeaders));
      inboundPayloads.unshift({ at: new Date().toISOString(), method: req.method, params, sipHeaders });
      inboundPayloads.length = Math.min(inboundPayloads.length, 10);

      const twiml = await inboundTwiml(req, params);
      send(res, 200, twiml, 'application/xml');
      return;
    }

    if (url.pathname === '/last-inbound') {
      send(res, 200, JSON.stringify(inboundPayloads, null, 2), 'application/json');
      return;
    }

    send(res, 404, 'not found');
  } catch (error) {
    log('HTTP error:', error);
    send(res, 500, String(error?.stack ?? error));
  }
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  const connectionId = randomUUID();
  log('websocket connected', connectionId);

  ws.on('message', async (data) => {
    try {
      const body = JSON.parse(data.toString());
      log('ws message', connectionId, body.type);

      if (body.type === 'setup') await handleSetup(ws, connectionId, body);
      else if (body.type === 'prompt') await handlePrompt(connectionId, body);
      else if (body.type === 'interrupt') log('interrupt', body);
      else if (body.type === 'dtmf') handleDtmf(connectionId, body);
      else if (body.type === 'error') log('ConversationRelay error', body);
    } catch (error) {
      log('WebSocket message error:', error);
      sendWs(ws, { type: 'text', token: 'The local translation server hit an error.', last: true });
    }
  });

  ws.on('close', () => handleDisconnect(connectionId));
  ws.on('error', (error) => log('WebSocket error:', error));
});

if (process.env.TEST_COMBO) {
  try {
    getCombo(process.env.TEST_COMBO);
  } catch (error) {
    console.error(String(error?.message ?? error));
    process.exit(1);
  }
}

server.listen(port, () => {
  log(`Local ConversationRelay server listening on http://localhost:${port}`);
  log(`Twilio webhook: ${process.env.PUBLIC_BASE_URL || '<your tunnel>'}/twiml/inbound`);
  // DIAGNOSTIC: confirm the resolved hold-music config the running server is using.
  log('hold-music config:', holdMusicConfig());
});
