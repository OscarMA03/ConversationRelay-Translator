# ConversationRelay Voice Provider Comparison

Speed, quality, and cost of the speech providers Twilio ConversationRelay supports,
researched 2026-06-11. This app sets providers per call via the `transcriptionProvider`,
`ttsProvider`, and `voice` TwiML attributes (see `local-server/server.mjs` and
`lambdas/twiml/inbound/call-setup-post/app.mjs`).

**Current defaults in this project:** Deepgram (STT) + Amazon Polly Generative (TTS),
voices `Matthew-Generative` / `Lupe-Generative`.

## How billing works

Twilio charges a **flat $0.07/min for ConversationRelay regardless of provider**
(no published surcharge for ElevenLabs or premium voices), plus the normal voice
call leg (~$0.0085/min inbound, ~$0.014/min outbound, US). Provider choice
therefore does not change what you pay — the "direct list price" columns below
are what the providers charge outside Twilio, included for reference only.

Twilio's own end-to-end ConversationRelay benchmark: **~491 ms median / ~713 ms p95**.

## Speech-to-text (`transcriptionProvider`)

Only two providers are supported: `Deepgram` and `Google`.

| Provider / model | Speed (streaming) | Quality (word error rate) | Direct list price | Notes |
|---|---|---|---|---|
| **Deepgram Nova-3** (current) | ~150–300 ms to transcript — fastest in every benchmark | ~6.8% WER streaming, best in class for conversational audio | $0.0048–0.0077/min | Default `speechModel` for new Twilio accounts; EN/ES/FR/DE/PT/IT all supported; `multi` mode handles live code-switching across 10 languages |
| **Deepgram Flux** | Cuts another 200–600 ms by fusing transcription + end-of-turn detection | Nova-family accuracy, ~30% fewer false interruptions | $0.0065–0.0078/min | Added May 2026; set `speechModel="flux"`; unlocks `eotThreshold`, `partialPrompts` attributes |
| **Google (telephony model)** | ~830 ms word-emission in independent tests; Google publishes no figures | ~13–14% WER on conversational audio | $0.016/min | Twilio notes it can do better in noisy-audio environments; `speechModel`: `telephony` or `long` |

**Verdict:** Deepgram wins on speed, accuracy, and price simultaneously. The
experiment worth running is `flux`.

## Text-to-speech (`ttsProvider`)

Three providers: `ElevenLabs`, `Amazon` (Polly), `Google`.

| Provider / tier | Speed (time to first audio) | Quality | Direct list price (~$/min spoken) | Notes |
|---|---|---|---|---|
| **ElevenLabs Flash v2.5** | ~75 ms model / ~290 ms measured — fastest premium option | Best available in ConversationRelay (blind-test winner) | ~$0.045 ($50/1M chars) | Twilio's default (`flash_v2_5`); 32 languages, same voice identity across languages; pick model via `voiceId-flash_v2_5` |
| **ElevenLabs Turbo v2.5** | ~265 ms measured | Slightly above Flash in arena rankings | ~$0.045 | Deprecated by ElevenLabs in favor of Flash — skip |
| **Amazon Polly Generative** (current) | Unpublished; roughly 100–500 ms est. | Good — roughly tied with Google Chirp 3 HD, a step below ElevenLabs | ~$0.027 ($30/1M chars) | Current voices `Matthew-Generative`/`Lupe-Generative`; no Portugal-Portuguese generative voice (pt-BR only) |
| **Google Chirp 3 HD** | ~300–600 ms streaming — the weak point | Roughly tied with Polly Generative | ~$0.027 ($30/1M chars) | 8 voice personas consistent across 31 locales — nice for translation apps |
| **Polly Neural / Google Neural2** | Fast (~100–300 ms) | Noticeably more robotic — bottom of the realistic options | ~$0.014 ($16/1M chars) | Budget tier |

**Verdict:** ElevenLabs Flash v2.5 is faster and better-sounding than the current
Polly Generative voices, at the same Twilio price. Caveats: it can stumble on raw
numbers/abbreviations (use the `elevenlabsTextNormalization` attribute) and only
supports `<phoneme>` SSML in English.

## Testing the Polly tiers (test mode)

The local server has a built-in test mode that rotates through every Amazon
Polly tier available in ConversationRelay and records timing:

| Combo | TTS tier | Caller / agent voice |
|---|---|---|
| 1 | Polly Generative (current default) | Matthew-Generative / Lupe-Generative |
| 2 | Polly Neural | Matthew-Neural / Lupe-Neural |
| 3 | Polly Standard | Matthew / Lupe |

STT stays on Deepgram nova-3 for every combo — ConversationRelay has no AWS
speech-to-text option.

### Protocol

1. Set `PROVIDER_TEST_MODE=true` in `.env`, start the server and ngrok, and
   have both testers ready (`AUTO_DIAL_AGENT=true` dials the second phone).
2. Call in 3 times. The welcome greeting announces the active combo
   ("Test combo 2: Polly Neural"). Set `TEST_COMBO=2` to pin one instead.
3. Read the same short script on every call, and reply immediately when you
   hear each translated phrase — that keeps the timing comparable.
4. Note per call: first-word delay, naturalness, pronunciation of numbers and
   names.
5. Run `npm run report` (or `GET /results`) for the per-combo table:
   sessions, turns, translate latency, turn-around time, and prompts-per-leg
   (lower = cleaner endpointing).

Turn-around time includes TTS synthesis + playback, the listener's reply, and
transcription — only *differences between combos* are meaningful, and only
when calls follow the same script. Voice quality is judged by ear.

### Switching providers outside test mode

```bash
CALLER_TRANSCRIPTION_PROVIDER=Deepgram   # or Google
CALLER_TTS_PROVIDER=Amazon               # or ElevenLabs, Google
CALLER_VOICE=Matthew-Generative          # provider-specific voice ID
```

## Sources

- Twilio ConversationRelay TwiML reference and voice configuration docs
- Twilio pricing pages (voice, conversational AI) — $0.07/min confirmed on three pages
- Deepgram pricing/docs; Google Cloud STT v2 + TTS pricing; AWS Polly pricing; ElevenLabs API pricing
- Independent benchmarks: Artificial Analysis (STT WER, TTS arena), Coval/Gradium
  (streaming TTFA, May 2026), Voicewriter STT leaderboard, Picovoice latency benchmarks
