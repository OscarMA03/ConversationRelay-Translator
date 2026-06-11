# Voice Provider Comparison — Speed, Quality, Cost

Quick-reference tables for the speech providers Twilio ConversationRelay supports
(researched 2026-06-11). Full details, sources, and the live test protocol are in
[`docs/voice-provider-comparison.md`](docs/voice-provider-comparison.md).

**This project currently uses:** Deepgram nova-3 (speech-to-text) + AWS
Translate (~80–183 ms measured) + **ElevenLabs Flash v2.5** (text-to-speech,
adopted after live testing — see the table below).

**Billing:** Twilio charges a flat **$0.07/min** for ConversationRelay regardless
of provider (plus the normal call leg). The price columns below are the providers'
direct list prices, for reference only — switching providers costs you nothing extra.

## Speech-to-text (`transcriptionProvider`)

| Provider / model | Speed (streaming) | Quality (word error rate) | Cost to us | Notes |
|---|---|---|---|---|
| **Deepgram Nova-3** (current) | ~150–300 ms — fastest in every benchmark | ~6.8% WER, best in class | $0.07/min flat¹ | Default; EN/ES/FR/DE/PT/IT + live code-switching |
| **Deepgram Flux** | Another 200–600 ms faster turn detection | Nova accuracy, ~30% fewer false interruptions | $0.07/min flat¹ | New May 2026; `speechModel="flux"` |
| **Google telephony** | ~830 ms in independent tests | ~13–14% WER | $0.07/min flat¹ | Can do better in noisy audio per Twilio |

¹ Twilio's single ConversationRelay rate covers STT + TTS together — provider
choice never changes the bill. (Direct list prices, only relevant outside
Twilio: Deepgram nova-3 ~$0.005–0.008/min, flux ~$0.007, Google ~$0.016.)

## Text-to-speech (`ttsProvider`)

Includes results from our own live test calls (2026-06-11, es↔en two-party
translation; full data in `docs/polly-tier-test-results.md`). "Turn-around" is
the full measured loop: text sent → TTS + playback + reply + transcription.

| Provider / tier | Speed (first audio) | Our measured turn-around | Quality (blind-test rank) | Our verdict by ear | Cost to us |
|---|---|---|---|---|---|
| **ElevenLabs Flash v2.5** ← current | ~290 ms — fastest premium | **3.5 s avg, fastest turn 0.95 s** 🏆 | Best in ConversationRelay (global top ~25) | 🏆 Our pick — natural and snappy | $0.07/min flat² |
| **ElevenLabs Turbo v2.5** | ~265 ms | not tested | Slightly above Flash | — (skip, deprecated) | $0.07/min flat² |
| **Amazon Polly Generative** | ~100–500 ms est. (unpublished) | 6.2 s avg | ~rank 33, tied w/ Chirp 3 HD | Natural; best Polly | $0.07/min flat² |
| **Amazon Polly Neural** | Fast (~100–300 ms) | 5.2 s avg | Elo ~868 (legacy tier) | Decent | $0.07/min flat² |
| **Amazon Polly Standard** | Fast | 6.3 s avg | bottom tier | Robotic | $0.07/min flat² |
| **Google Chirp 3 HD** | ~300–600 ms — its weak point | not tested | Tied with Polly Generative | — | $0.07/min flat² |

² Same flat Twilio rate for every voice — quality upgrades are free. (Direct
list prices, only relevant outside Twilio: ElevenLabs ~$0.045/min, Polly
Generative ~$0.027, Neural ~$0.014, Standard ~$0.0036, Chirp 3 HD ~$0.027.)

Pipeline context from the same calls: the translate hop (AWS Translate) measured
80–183 ms — a rounding error. Perceived delay is dominated by STT end-of-utterance
detection (~1 s) plus TTS; switching Polly → ElevenLabs roughly halved turn-around.

## Bottom line

- **STT:** already on the best option (Deepgram); the experiment worth trying is `flux`.
- **TTS: tested and decided** — ElevenLabs Flash v2.5 won our live test (~2–3 s
  faster per turn than every Polly tier, better by ear, same flat Twilio price)
  and is now the default. Weak spots to watch: raw numbers/abbreviations and
  English-only SSML.
- **Re-test anytime:** set `PROVIDER_TEST_MODE=true` in `.env`, call, then
  `npm run report`. Full results log: `docs/polly-tier-test-results.md`.
