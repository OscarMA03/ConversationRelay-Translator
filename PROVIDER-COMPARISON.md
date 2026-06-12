# Voice Provider Comparison

> **TL;DR** — Every option costs the same flat **$0.07/min** through Twilio, and speed
> differences can't be felt in real conversation — so **how the voice sounds decides**.
> ElevenLabs sounds human; every Polly tier sounds robotic.

**Our current pipeline:**

```
🎙️ Deepgram nova-3   →   🌐 AWS Translate (~160 ms)   →   🗣️ ElevenLabs Flash v2.5
   speech to text          text to text                     text to speech
```

Tested live 2026-06-11/12, Spanish caller ↔ English agent, ~115 measured exchanges.
Research and sources: [`docs/voice-provider-comparison.md`](docs/voice-provider-comparison.md) ·
Test data: [`docs/polly-tier-test-results.md`](docs/polly-tier-test-results.md)

---

## 🎙️ Speech-to-text

| Provider / model | Speed (streaming)<br><sub>time from speech to transcript</sub> | Accuracy<br><sub>word error rate — lower is better</sub> | Cost¹<br><sub>flat, per minute</sub> | Notes |
|:--|:--|:--|:--:|:--|
| **Deepgram Nova-3** ← current | ~150–300 ms *(vendor)* — fastest tested everywhere | **~6.8%** — best in class | $0.07 | EN/ES/FR/DE/PT/IT + live code-switching (`multi`) |
| **Deepgram Flux** | 200–600 ms faster turn detection *(vendor claim)* | Nova accuracy, ~30% fewer false cut-offs | $0.07 | The next experiment — would target our 3.8 fragments/call |
| **Google telephony** | ~830 ms *(independently measured)* | ~13–14% | $0.07 | Twilio says it can win in noisy audio |

---

## 🗣️ Text-to-speech

| Provider / tier | Verdict by ear<br><sub>how it sounded on our real calls</sub> | Same voice in both languages?<br><sub>one "translator" voice for es + en?</sub> | Voice selection<br><sub>what you can pick from</sub> | Words/sentence²<br><sub>cycle-3 sentence length</sub> | Exchange time³<br><sub>speak → reply → transcribed</sub> | Cost¹<br><sub>flat, per minute</sub> |
|:--|:--|:--|:--|:--:|:--:|:--:|
| 🏆 **ElevenLabs Flash v2.5** ← current | **Feels like an actual human talking** | ✅ Your choice — same voice or one per language *(ours: different)* | 1,000+ voices · 32 languages | 11.3 | ~10.7 s | $0.07 |
| **ElevenLabs Turbo v2.5** | Human-like too — but deprecated, skip | ✅ Your choice | same library | 10.6 | ~12.7 s | $0.07 |
| **Amazon Polly Generative** | Best Polly — still sounds robotic, flow seems off | ❌ Persona switches per language | ~43 voices · no pt-PT | 18.8 | ~12.4 s | $0.07 |
| **Amazon Polly Neural** | Sounds robotic, flow seems off | ❌ | wide catalog | 10.4 | ~8.7 s | $0.07 |
| **Amazon Polly Standard** | Very robotic, flow seems off | ❌ | wide catalog | 11.7 | ~13.4 s | $0.07 |

¹ **Twilio's flat ConversationRelay rate covers everything** — transcription, relay, and voice,
whichever providers you pick. Quality upgrades are free. *(Direct list prices, only relevant
outside Twilio: ElevenLabs ~$0.045/min · Polly Generative ~$0.027 · Neural ~$0.014 ·
Standard ~$0.0036 · Deepgram ~$0.005–0.008 · Google STT ~$0.016.)*

² Context for exchange time, not a property of the voice — longer sentences simply take longer
to read aloud (Polly Generative's 18.8-word sentences explain its slower loop).

³ One full measured loop on a real call, normalized to a standard 60-character sentence. Treat
as indicative: across all ~115 exchanges every tier averaged 10–12 s — **statistically
indistinguishable**. Conversation pace is set by the humans, not the voice. Lab-measured voice
start-up: ElevenLabs ~288 ms *(independently measured)*; Polly unpublished.

**Upstream of the voice (identical for every tier):** translation ~160 ms avg, accurate in both
directions (74 pairs reviewed — quirk: Spanish questions can translate as statements) ·
transcription choppiness ~3.8 fragments/call · English spoken on the Spanish line garbles
transcripts (Deepgram `multi` mode is the untested fix).

---

## Bottom line

- **Speech-to-text:** already on the best option (Deepgram Nova-3). Next experiment: **Flux**.
- **Text-to-speech: tested and decided** — 🏆 **ElevenLabs Flash v2.5**, the only voice that
  sounds human, at the same price as the most robotic option.
- **Re-test anytime:** set `PROVIDER_TEST_MODE=true` in `.env`, call in, then `npm run report`.
