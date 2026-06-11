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
  },
  {
    id: 4,
    label: 'ElevenLabs Flash v2.5',
    transcriptionProvider: 'Deepgram',
    speechModel: 'nova-3-general',
    ttsProvider: 'ElevenLabs',
    // Same voices as combo 5 so the only variable is the model suffix.
    callerVoice: '94zOad0g7T7K4oa7zhDq-flash_v2_5',
    agentVoice: '6OzrBCQf8cjERkYgzSg8-flash_v2_5'
  },
  {
    id: 5,
    label: 'ElevenLabs Turbo v2.5',
    transcriptionProvider: 'Deepgram',
    speechModel: 'nova-3-general',
    ttsProvider: 'ElevenLabs',
    callerVoice: '94zOad0g7T7K4oa7zhDq-turbo_v2_5',
    agentVoice: '6OzrBCQf8cjERkYgzSg8-turbo_v2_5'
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
