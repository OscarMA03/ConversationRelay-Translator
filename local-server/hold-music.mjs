// Plays hold music to the caller while we wait for the agent leg to answer.
// ConversationRelay gives each caller a SINGLE audio channel, so the music and the
// spoken reassurance line are sequential, not mixed. We rely on the documented
// `preemptible` semantics to order them:
//   - music        -> preemptible:true  (a later non-preemptible text stops it)
//   - spoken line  -> preemptible:false (so a following `play` queues behind it)
//   - resume music -> sent right after the line; it waits its turn, then plays.

const DEFAULT_MUSIC_URL = 'https://api.twilio.com/cowbell.mp3'; // obvious placeholder sample
const DEFAULT_LINE =
  "Thank you for your patience. We're still connecting you — please stay on the line.";
const DEFAULT_TIMEOUT_LINE =
  "We're sorry, no one is available to take your call right now. Please try again later.";

function envBool(value, fallback) {
  return value === undefined ? fallback : value === 'true';
}

// Parse a millisecond env value, falling back on anything non-finite. Guards
// against a typo'd value (e.g. "abc") becoming NaN -> setTimeout(0), which would
// fire the line immediately or hang the caller up almost instantly.
function envMs(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Read config from env once (overridable for tests). */
export function holdMusicConfig(env = process.env) {
  return {
    enabled: envBool(env.HOLD_MUSIC_ENABLED, true),
    url: env.HOLD_MUSIC_URL || DEFAULT_MUSIC_URL,
    delayMs: envMs(env.HOLD_MUSIC_DELAY_MS, 10000),
    linePauseMs: envMs(env.HOLD_LINE_PAUSE_MS, 7000),
    repeatMs: envMs(env.HOLD_MUSIC_REPEAT_MS, 15000),
    timeoutMs: envMs(env.HOLD_TIMEOUT_MS, 45000),
    message: env.HOLD_MUSIC_MESSAGE || DEFAULT_LINE,
    timeoutMessage: env.HOLD_TIMEOUT_MESSAGE || DEFAULT_TIMEOUT_LINE,
  };
}

function playMusic(send, ws, url) {
  send(ws, { type: 'play', source: url, loop: 0, preemptible: true, interruptible: false });
}

function speak(send, ws, token) {
  send(ws, { type: 'text', token, last: true, preemptible: false, interruptible: false });
}

/**
 * Start hold music for a caller leg and arm the two timers.
 * @param party     caller connection object (timer handles are stashed on it)
 * @param send      sendWs-style (ws, payload) => void
 * @param translate translateText-style (text, from, to) => Promise<string>
 * @param config    defaults to holdMusicConfig()
 * @param timers    setTimeout/clearTimeout (injectable for tests)
 */
export function startHoldMusic(
  party,
  { send, translate, config = holdMusicConfig(), timers = { setTimeout, clearTimeout } } = {}
) {
  if (!config.enabled || !party?.ws) return;
  const lang = party.sourceLanguageCode || 'en';

  // (a) start looping music — preemptible so a later text can stop it
  playMusic(send, party.ws, config.url);

  // (b) Cycle forever until cleared: speak the line (which stops the music), wait
  // out the line, then resume the music, then wait repeatMs and do it again.
  // The resume must NOT be sent back-to-back with the line — ConversationRelay
  // drops a play issued while the line's TTS is still playing, so the music never
  // comes back. Waiting linePauseMs lets the channel go idle first.
  const speakLine = async () => {
    speak(send, party.ws, await localize(translate, config.message, lang));
    party.holdResumeTimer = timers.setTimeout(() => {
      playMusic(send, party.ws, config.url);
      party.holdLineTimer = timers.setTimeout(speakLine, config.repeatMs);
    }, config.linePauseMs);
  };
  party.holdLineTimer = timers.setTimeout(speakLine, config.delayMs);

  // (c) no-answer timeout: apologize (stops the music) then hang up the caller leg
  party.holdTimeoutTimer = timers.setTimeout(async () => {
    speak(send, party.ws, await localize(translate, config.timeoutMessage, lang));
    send(party.ws, { type: 'end', handoffData: JSON.stringify({ reasonCode: 'agent-no-answer' }) });
    clearHoldMusic(party, timers);
  }, config.timeoutMs);
}

/** Cancel all hold timers. Safe to call multiple times. */
export function clearHoldMusic(party, timers = { clearTimeout }) {
  for (const key of ['holdLineTimer', 'holdResumeTimer', 'holdTimeoutTimer']) {
    if (party?.[key]) { timers.clearTimeout(party[key]); party[key] = null; }
  }
}

/** Translate to the caller's language; fall back to English rather than going silent. */
async function localize(translate, text, lang) {
  if (!translate || !lang || lang === 'en' || lang.startsWith('en-')) return text;
  try {
    return await translate(text, 'en', lang);
  } catch {
    return text;
  }
}
