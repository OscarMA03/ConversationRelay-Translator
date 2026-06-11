import 'dotenv/config';

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import { TranslateClient, TranslateTextCommand } from '@aws-sdk/client-translate';
import { WebSocketServer } from 'ws';

const port = Number(process.env.PORT ?? 3000);
const translateClient = new TranslateClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

/** @type {Map<string, Record<string, any>>} */
const connections = new Map();
/** @type {Array<Record<string, any>>} */
const transcript = [];

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

function callerContext(params = {}) {
  return {
    name: process.env.CALLER_NAME ?? 'Caller',
    sourceLanguageCode: process.env.CALLER_TRANSLATE_CODE ?? 'en',
    sourceLanguage: process.env.CALLER_LANGUAGE ?? 'en-US',
    sourceLanguageFriendly: process.env.CALLER_LANGUAGE_FRIENDLY ?? 'English - United States',
    sourceTranscriptionProvider: process.env.CALLER_TRANSCRIPTION_PROVIDER ?? 'Deepgram',
    sourceTtsProvider: process.env.CALLER_TTS_PROVIDER ?? 'Amazon',
    sourceVoice: process.env.CALLER_VOICE ?? 'Matthew-Generative',
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
    targetCallSid: 'notset'
  };
}

function agentContext() {
  return {
    name: process.env.AGENT_NAME ?? 'Agent',
    sourceLanguageCode: process.env.AGENT_TRANSLATE_CODE ?? 'es',
    sourceLanguage: process.env.AGENT_LANGUAGE ?? 'es-MX',
    sourceLanguageFriendly: process.env.AGENT_LANGUAGE_FRIENDLY ?? 'Spanish - Mexico',
    sourceTranscriptionProvider: process.env.AGENT_TRANSCRIPTION_PROVIDER ?? 'Deepgram',
    sourceTtsProvider: process.env.AGENT_TTS_PROVIDER ?? 'Amazon',
    sourceVoice: process.env.AGENT_VOICE ?? 'Lupe-Generative'
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

function inboundTwiml(req, twilioParams) {
  const context = callerContext(twilioParams);
  return buildConversationRelayTwiml({
    wsUrl: getWsUrl(req),
    relay: {
      welcomeGreeting: 'Please wait while we connect you to a translator.',
      dtmfDetection: 'false',
      interruptByDtmf: 'false',
      language: context.sourceLanguage,
      transcriptionProvider: context.sourceTranscriptionProvider,
      ttsProvider: context.sourceTtsProvider,
      voice: context.sourceVoice
    },
    params: context
  });
}

function outboundAgentTwiml(callerParty) {
  const context = agentContext();
  const params = {
    ...context,
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
      welcomeGreeting: 'Initiating translation session.',
      dtmfDetection: 'false',
      interruptByDtmf: 'false',
      language: context.sourceLanguage,
      transcriptionProvider: context.sourceTranscriptionProvider,
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

async function translateText(text, sourceLanguageCode, targetLanguageCode) {
  if (!text || sourceLanguageCode === targetLanguageCode) return text;

  if ((process.env.TRANSLATION_PROVIDER ?? 'aws') === 'mock') {
    return `[${targetLanguageCode}] ${text}`;
  }

  try {
    const response = await translateClient.send(new TranslateTextCommand({
      Text: text,
      SourceLanguageCode: sourceLanguageCode,
      TargetLanguageCode: targetLanguageCode
    }));
    return response.TranslatedText ?? text;
  } catch (error) {
    log('Translate failed:', error?.message ?? error);
    if (process.env.TRANSLATION_FALLBACK_ORIGINAL !== 'false') return text;
    throw error;
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
  const twiml = outboundAgentTwiml(callerParty);
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

  connections.set(connectionId, party);
  log('setup', { connectionId, whichParty: party.whichParty, callSid: party.callSid });

  if (party.whichParty === 'caller') {
    await maybeDialAgent(party);
    return;
  }

  if (party.whichParty === 'callee') {
    const caller = connections.get(party.targetConnectionId);
    if (!caller) {
      sendWs(ws, { type: 'text', token: 'Could not find the caller leg for this translation session.', last: true });
      return;
    }

    caller.translationActive = true;
    caller.targetConnectionId = connectionId;
    caller.targetLanguageCode = party.sourceLanguageCode;
    caller.targetLanguage = party.sourceLanguage;
    caller.targetTranscriptionProvider = party.sourceTranscriptionProvider;
    caller.targetTtsProvider = party.sourceTtsProvider;
    caller.targetVoice = party.sourceVoice;
    caller.targetCallSid = party.callSid;

    party.translationActive = true;
    party.targetConnectionId = caller.pk;

    sendWs(caller.ws, { type: 'text', token: 'The translation session has begun.', last: true });
    sendWs(party.ws, { type: 'text', token: 'The translation session has begun.', last: true });
  }
}

async function handlePrompt(connectionId, body) {
  const party = connections.get(connectionId);
  if (!party) return;

  const text = body.voicePrompt ?? body.prompt ?? body.text ?? '';
  if (!text) return;

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
}

function handleDisconnect(connectionId) {
  const party = connections.get(connectionId);
  if (!party) return;

  party.callStatus = 'disconnected';
  connections.delete(connectionId);
  log('disconnect', { connectionId, whichParty: party.whichParty });

  const target = connections.get(party.targetConnectionId);
  if (target) {
    target.translationActive = false;
    sendWs(target.ws, { type: 'text', token: 'The other person has ended the call.', last: true });
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

    if (url.pathname === '/twiml/inbound') {
      const params = await parseTwilioRequest(req);
      const twiml = inboundTwiml(req, params);
      log('served inbound TwiML', { from: params.From, to: params.To, wsUrl: getWsUrl(req) });
      send(res, 200, twiml, 'application/xml');
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
      else if (body.type === 'dtmf') log('dtmf', body);
      else if (body.type === 'error') log('ConversationRelay error', body);
    } catch (error) {
      log('WebSocket message error:', error);
      sendWs(ws, { type: 'text', token: 'The local translation server hit an error.', last: true });
    }
  });

  ws.on('close', () => handleDisconnect(connectionId));
  ws.on('error', (error) => log('WebSocket error:', error));
});

server.listen(port, () => {
  log(`Local ConversationRelay server listening on http://localhost:${port}`);
  log(`Twilio webhook: ${process.env.PUBLIC_BASE_URL || '<your tunnel>'}/twiml/inbound`);
});
