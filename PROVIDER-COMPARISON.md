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

| Provider / tier | Speed (first audio) | Our measured ms/char (cycle 3)³ | Quality (blind-test rank) | Our verdict by ear | Cost to us² |
|---|---|---|---|---|---|
| **ElevenLabs Flash v2.5** ← current | ~288 ms (independently measured) | 179 avg (90–292) | Best in ConversationRelay (global top ~25) | 🏆 Our pick — feels like an actual human talking | $0.07/min flat |
| **ElevenLabs Turbo v2.5** | ~264 ms (independently measured; tie with Flash) | 212 avg (77–437) | Slightly above Flash | Human-like too, but deprecated — skip | $0.07/min flat |
| **Amazon Polly Generative** | ~100–500 ms (estimate only; AWS publishes nothing) | 206 avg (108–398) | ~rank 33, tied w/ Chirp 3 HD | Best Polly, still feels robotic | $0.07/min flat |
| **Amazon Polly Neural** | ~100–300 ms (third-party benchmarks) | 145 avg (29–236) | Elo ~868 (legacy tier) | Robotic feel | $0.07/min flat |
| **Amazon Polly Standard** | Fast | 223 avg (120–348) | bottom tier | Robotic | $0.07/min flat |
| **Google Chirp 3 HD** | ~300–600 ms (mixed reports) — its weak point | not tested | Tied with Polly Generative | — | $0.07/min flat |

² Same flat Twilio rate for every voice — quality upgrades are free. (Direct
list prices, only relevant outside Twilio: ElevenLabs ~$0.045/min, Polly
Generative ~$0.027, Neural ~$0.014, Standard ~$0.0036, Chirp 3 HD ~$0.027.)

³ ms/char = live-call turn-around ÷ characters the voice spoke (cycle 3 of our
test, the only cycle with sentence-length tracking; 6–10 turns per tier).
Treat as indicative only — the ranking does not stabilize at this sample size
(per-turn spread is 3–4×, human reply time dominates), and across all 3 cycles
(~115 turns) every tier averaged 10–12 s per turn: statistically
indistinguishable. For tier-vs-tier speed, trust the independently measured
figures in the speed column. Translate hop: 145–197 ms avg, a non-factor.
Full data: `docs/polly-tier-test-results.md`.

## Bottom line

- **STT:** already on the best option (Deepgram); the experiment worth trying is `flux`.
- **TTS: tested and decided** — ElevenLabs Flash v2.5 is the default, chosen on
  voice quality (our ears + blind-test rankings) and published speed benchmarks;
  our own 3-cycle live test showed tier choice doesn't measurably change total
  turn latency at conversation pace. Weak spots to watch: raw
  numbers/abbreviations and English-only SSML.
- **Re-test anytime:** set `PROVIDER_TEST_MODE=true` in `.env`, call, then
  `npm run report`. Full results log: `docs/polly-tier-test-results.md`.
