# Voice Provider Comparison — Speed, Quality, Cost

Quick-reference tables for the speech providers Twilio ConversationRelay supports
(researched 2026-06-11). Full details, sources, and the live test protocol are in
[`docs/voice-provider-comparison.md`](docs/voice-provider-comparison.md).

**This project currently uses:** Deepgram (speech-to-text) + Amazon Polly
Generative (text-to-speech).

**Billing:** Twilio charges a flat **$0.07/min** for ConversationRelay regardless
of provider (plus the normal call leg). The price columns below are the providers'
direct list prices, for reference only — switching providers costs you nothing extra.

## Speech-to-text (`transcriptionProvider`)

| Provider / model | Speed (streaming) | Quality (word error rate) | Direct list price | Notes |
|---|---|---|---|---|
| **Deepgram Nova-3** (current) | ~150–300 ms — fastest in every benchmark | ~6.8% WER, best in class | $0.0048–0.0077/min | Default; EN/ES/FR/DE/PT/IT + live code-switching |
| **Deepgram Flux** | Another 200–600 ms faster turn detection | Nova accuracy, ~30% fewer false interruptions | $0.0065–0.0078/min | New May 2026; `speechModel="flux"` |
| **Google telephony** | ~830 ms in independent tests | ~13–14% WER | $0.016/min | Can do better in noisy audio per Twilio |

## Text-to-speech (`ttsProvider`)

| Provider / tier | Speed (first audio) | Quality | Direct list price (~$/min) | Notes |
|---|---|---|---|---|
| **ElevenLabs Flash v2.5** | ~290 ms measured — fastest premium | Best available in ConversationRelay | ~$0.045 | Twilio's default; same voice across 32 languages |
| **ElevenLabs Turbo v2.5** | ~265 ms | Slightly above Flash | ~$0.045 | Deprecated by ElevenLabs — skip |
| **Amazon Polly Generative** (current) | ~100–500 ms est. (unpublished) | Tied with Google Chirp 3 HD | ~$0.027 | `Matthew-Generative` / `Lupe-Generative` |
| **Google Chirp 3 HD** | ~300–600 ms — its weak point | Tied with Polly Generative | ~$0.027 | 8 voice personas across 31 locales |
| **Polly Neural / Google Neural2** | Fast (~100–300 ms) | Noticeably robotic | ~$0.014 | Budget tier |

## Bottom line

- **STT:** already on the best option (Deepgram); the experiment worth trying is `flux`.
- **TTS:** ElevenLabs Flash v2.5 is faster and better-sounding than Polly Generative
  at the same Twilio price; its weak spots are raw numbers/abbreviations and
  English-only SSML.
- **Test the Polly tiers yourself:** set `PROVIDER_TEST_MODE=true` in `.env`, make
  3 calls, then `npm run report`.
