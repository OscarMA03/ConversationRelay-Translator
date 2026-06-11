/**
 * Voice provider test combos for PROVIDER_TEST_MODE.
 *
 * ConversationRelay has no AWS speech-to-text option (only Deepgram and
 * Google), so STT stays pinned at Deepgram nova-3 and the only variable is
 * the Amazon Polly TTS tier. Add rows here to test other providers later
 * (e.g. ElevenLabs, Google Chirp3-HD, Deepgram flux).
 *
 * Voices are per leg: the caller speaks/hears Spanish (Lupe), the agent
 * speaks/hears English (Matthew). Swap them if the call direction changes.
 */
export const COMBOS = [
  {
    id: 1,
    label: 'Polly Generative',
    transcriptionProvider: 'Deepgram',
    speechModel: 'nova-3-general',
    ttsProvider: 'Amazon',
    callerVoice: 'Lupe-Generative',
    agentVoice: 'Matthew-Generative'
  },
  {
    id: 2,
    label: 'Polly Neural',
    transcriptionProvider: 'Deepgram',
    speechModel: 'nova-3-general',
    ttsProvider: 'Amazon',
    callerVoice: 'Lupe-Neural',
    agentVoice: 'Matthew-Neural'
  },
  {
    id: 3,
    label: 'Polly Standard',
    transcriptionProvider: 'Deepgram',
    speechModel: 'nova-3-general',
    ttsProvider: 'Amazon',
    callerVoice: 'Lupe',
    agentVoice: 'Matthew'
  }
];

let rotation = 0;

export function getCombo(id) {
  const combo = COMBOS.find((c) => c.id === Number(id));
  if (!combo) {
    throw new Error(
      `Unknown test combo "${id}". Valid combos: ${COMBOS.map((c) => c.id).join(', ')}`
    );
  }
  return combo;
}

export function nextCombo() {
  if (process.env.TEST_COMBO) return getCombo(process.env.TEST_COMBO);
  const combo = COMBOS[rotation % COMBOS.length];
  rotation += 1;
  return combo;
}

export function resetRotation() {
  rotation = 0;
}
