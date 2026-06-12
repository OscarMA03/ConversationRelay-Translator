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

Results from our own live test calls (2026-06-11, es↔en two-party translation;
full data in `docs/polly-tier-test-results.md`).

| Provider / tier | Our verdict by ear<br><sub>how the voice actually sounded on real calls</sub> | Same voice in both languages?⁵<br><sub>one "translator" voice for es + en, or persona switches</sub> | Voice selection<br><sub>voices/languages to pick from</sub> | Avg words/sentence (cycle 3)<br><sub>sentence length in that test call — longer = slower loops</sub> | Our live-call exchange time³<br><sub>voice speaks → person replies → reply transcribed</sub> | Cost to us²<br><sub>what we pay Twilio, flat per minute</sub> |
|---|---|---|---|---|---|---|
| **ElevenLabs Flash v2.5** ← current | 🏆 Our pick — feels like an actual human talking | Your choice — one voice can speak both es + en, or a different voice per language (our setup: different) | 1,000+ voices, 32 languages | 11.3 | ~10.7 s | $0.07/min flat |
| **ElevenLabs Turbo v2.5** | Human-like too, but deprecated — skip | Your choice (same as Flash) | Same library | 10.6 | ~12.7 s | $0.07/min flat |
| **Amazon Polly Generative** | Best Polly — still sounds robotic and the flow seems off | ❌ No — different persona per language | ~43 voices; no Portugal-Portuguese | 18.8 | ~12.4 s | $0.07/min flat |
| **Amazon Polly Neural** | Voice sounds robotic and the flow seems off | ❌ No | Wide catalog | 10.4 | ~8.7 s | $0.07/min flat |
| **Amazon Polly Standard** | Very robotic and the flow seems off | ❌ No | Wide catalog | 11.7 | ~13.4 s | $0.07/min flat |

² Same flat Twilio rate for every voice — quality upgrades are free. (Direct
list prices, only relevant outside Twilio: ElevenLabs ~$0.045/min, Polly
Generative ~$0.027, Neural ~$0.014, Standard ~$0.0036.)

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

⁵ Matters for a translation app: ElevenLabs voices are multilingual, so you
can give each person one consistent "translator" voice across both languages,
or assign different voices per language (our current setup uses two different
voices). Polly voices are single-language, so the persona always switches.
Avg words/sentence shows how long the sentences happened to be in each
cycle-3 call — context for the exchange-time column (combo 1's long
sentences explain its slower raw loop), not a property of the voice.

Pipeline stages upstream of the voice (identical regardless of tier):
transcription choppiness ~3.8 fragments/call (Deepgram; Flux would target
this), translation ~160 ms avg over 115 turns and accurate in both directions
(74 pairs reviewed; Spanish questions occasionally translate as statements;
English spoken on the Spanish line garbles transcription — Deepgram `multi`
mode is the untested fix).


## Bottom line

- **STT:** already on the best option (Deepgram); the experiment worth trying is `flux`.
- **TTS: tested and decided** — ElevenLabs Flash v2.5 is the default, chosen on
  voice quality (our ears + blind-test rankings) and published speed benchmarks;
  our own 3-cycle live test showed tier choice doesn't measurably change total
  turn latency at conversation pace. Weak spots to watch: raw
  numbers/abbreviations and English-only SSML.
- **Re-test anytime:** set `PROVIDER_TEST_MODE=true` in `.env`, call, then
  `npm run report`. Full results log: `docs/polly-tier-test-results.md`.
