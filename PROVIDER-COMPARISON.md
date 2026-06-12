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

| Provider / tier | Our live-call exchange time³ | Translation step⁵ | Choppiness⁵ | Our verdict by ear | Cost to us² |
|---|---|---|---|---|---|
| **ElevenLabs Flash v2.5** ← current | ~10.7 s | ~160 ms | ~3.8 fragments/call | 🏆 Our pick — feels like an actual human talking | $0.07/min flat |
| **ElevenLabs Turbo v2.5** | ~12.7 s | ~160 ms | ~3.8 | Human-like too, but deprecated — skip | $0.07/min flat |
| **Amazon Polly Generative** | ~12.4 s | ~160 ms | ~3.8 | Best Polly, still feels robotic | $0.07/min flat |
| **Amazon Polly Neural** | ~8.7 s | ~160 ms | ~3.8 | Robotic feel | $0.07/min flat |
| **Amazon Polly Standard** | ~13.4 s | ~160 ms | ~3.8 | Robotic | $0.07/min flat |
| **Google Chirp 3 HD** | not tested | ~160 ms | ~3.8 | — | $0.07/min flat |

² Same flat Twilio rate for every voice — quality upgrades are free. (Direct
list prices, only relevant outside Twilio: ElevenLabs ~$0.045/min, Polly
Generative ~$0.027, Neural ~$0.014, Standard ~$0.0036, Chirp 3 HD ~$0.027.)

³ "Exchange time" = one full measured loop on a real call: the voice speaks a
sentence → the listener hears it and replies → the reply is transcribed back.
Because longer sentences take longer just to read aloud, we measured time per
character and re-scaled every tier to the same standard sentence (60
characters) so they compare fairly. Treat as indicative only: at 6–10
exchanges per tier the differences are within human-reply noise (across all
~115 measured exchanges every tier averaged 10–12 s — statistically
indistinguishable). Translation's share of each exchange: ~0.15 s. Lab-measured
voice start-up delays (only solid for ElevenLabs, ~288 ms; unpublished for
Polly) live in `docs/voice-provider-comparison.md`.
Full data: `docs/polly-tier-test-results.md`.

⁵ Translation step (AWS Translate, ~160 ms avg over 115 turns, identical both
directions) and choppiness (~3.8 transcription fragments per call, from
Deepgram) are the same on every row because they happen before the voice —
they don't depend on which voice speaks the result. Translation quality (74
pairs reviewed): accurate and natural; quirks — Spanish questions can come out
as statements, and speaking English on the Spanish line garbles transcription
(Deepgram `multi` mode is the untested fix; Flux would target the ~3.8).


## Bottom line

- **STT:** already on the best option (Deepgram); the experiment worth trying is `flux`.
- **TTS: tested and decided** — ElevenLabs Flash v2.5 is the default, chosen on
  voice quality (our ears + blind-test rankings) and published speed benchmarks;
  our own 3-cycle live test showed tier choice doesn't measurably change total
  turn latency at conversation pace. Weak spots to watch: raw
  numbers/abbreviations and English-only SSML.
- **Re-test anytime:** set `PROVIDER_TEST_MODE=true` in `.env`, call, then
  `npm run report`. Full results log: `docs/polly-tier-test-results.md`.
