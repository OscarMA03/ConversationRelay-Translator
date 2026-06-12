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

**Reading the speed column:** figures are tagged by evidence grade —
*(independently measured)* = real instrumented benchmark, *(vendor)* = the
provider's own claim, *(estimate)* = no published data. Our own "measured
turn-around" column is real data from this project's calls, but it's a
composite (TTS + playback + human reply + STT): trust it for big gaps, not
small ones.

## Speech-to-text (`transcriptionProvider`)

| Provider / model | Speed (streaming) | Quality (word error rate) | Cost to us | Notes |
|---|---|---|---|---|
| **Deepgram Nova-3** (current) | ~150–300 ms (vendor); ~990 ms in one independent production test — still fastest STT tested | ~6.8% WER, best in class | $0.07/min flat¹ | Default; EN/ES/FR/DE/PT/IT + live code-switching |
| **Deepgram Flux** | 200–600 ms faster turn detection (vendor claim, unverified) | Nova accuracy, ~30% fewer false interruptions | $0.07/min flat¹ | New May 2026; `speechModel="flux"` |
| **Google telephony** | ~830 ms (independently measured) | ~13–14% WER | $0.07/min flat¹ | Can do better in noisy audio per Twilio |

¹ Twilio's single ConversationRelay rate covers STT + TTS together — provider
choice never changes the bill. (Direct list prices, only relevant outside
Twilio: Deepgram nova-3 ~$0.005–0.008/min, flux ~$0.007, Google ~$0.016.)

## Text-to-speech (`ttsProvider`)

Includes results from our own live test calls (2026-06-11, es↔en two-party
translation; full data in `docs/polly-tier-test-results.md`). "Turn-around" is
the full measured loop: text sent → TTS + playback + reply + transcription.

| Provider / tier | Speed (first audio) | Our measured turn-around | Quality (blind-test rank) | Our verdict by ear | Cost to us |
|---|---|---|---|---|---|
| **ElevenLabs Flash v2.5** ← current | ~288 ms (independently measured) | 11.7 s avg² | Best in ConversationRelay (global top ~25) | 🏆 Our pick — natural and snappy | $0.07/min flat² |
| **ElevenLabs Turbo v2.5** | ~264 ms (independently measured; tie with Flash) | 11.9 s avg² | Slightly above Flash | — (skip, deprecated) | $0.07/min flat² |
| **Amazon Polly Generative** | ~100–500 ms (estimate only; AWS publishes nothing) | 11.5 s avg² | ~rank 33, tied w/ Chirp 3 HD | Natural; best Polly | $0.07/min flat² |
| **Amazon Polly Neural** | ~100–300 ms (third-party benchmarks) | 10.2 s avg² | Elo ~868 (legacy tier) | Decent | $0.07/min flat² |
| **Amazon Polly Standard** | Fast | 10.7 s avg² | bottom tier | Robotic | $0.07/min flat² |
| **Google Chirp 3 HD** | ~300–600 ms (mixed reports) — its weak point | not tested | Tied with Polly Generative | — | $0.07/min flat² |

² Same flat Twilio rate for every voice — quality upgrades are free. (Direct
list prices, only relevant outside Twilio: ElevenLabs ~$0.045/min, Polly
Generative ~$0.027, Neural ~$0.014, Standard ~$0.0036, Chirp 3 HD ~$0.027.)

² Measured across 3 cycles (~115 turns, full AWS pipeline): **all five tiers
landed at 10–12 s per turn at natural conversation pace — statistically
indistinguishable**, even after normalizing for sentence length. Human reply
time dominates; sub-second TTS differences are below what a human-in-the-loop
test can resolve. Speed comparisons between tiers should rely on the
independently measured figures in the speed column. The translate hop measured
145–174 ms avg across all turns — a non-factor. Full data:
`docs/polly-tier-test-results.md`.

## Bottom line

- **STT:** already on the best option (Deepgram); the experiment worth trying is `flux`.
- **TTS: tested and decided** — ElevenLabs Flash v2.5 is the default, chosen on
  voice quality (our ears + blind-test rankings) and published speed benchmarks;
  our own 3-cycle live test showed tier choice doesn't measurably change total
  turn latency at conversation pace. Weak spots to watch: raw
  numbers/abbreviations and English-only SSML.
- **Re-test anytime:** set `PROVIDER_TEST_MODE=true` in `.env`, call, then
  `npm run report`. Full results log: `docs/polly-tier-test-results.md`.
