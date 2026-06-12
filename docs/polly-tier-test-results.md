# Polly Tier Test Results

Live two-party translation calls through ConversationRelay (caller: Spanish/Lupe,
agent: English/Matthew, STT: Deepgram nova-3 for all combos). Latency is measured
by the local server (`npm run report`); quality is by ear; cost is fixed.

**Cost (identical for every tier):** Twilio bills ConversationRelay at a flat
**$0.07/min** + the call legs (~$0.0085–0.014/min each), regardless of Polly tier.
Polly's direct list prices (Generative $30 / Neural $16 / Standard $4 per 1M chars)
do **not** apply here — tier choice is free, so this test is purely speed vs. quality.

**How to read turn-around:** time from the server sending translated text to a leg
until that person's reply arrives back. It includes TTS synthesis + playback +
human reaction + transcription, so only differences *between* combos matter, and
only when calls follow the same script.

## Run 1 — 2026-06-11 (rough pass, treat with caution)

⚠️ Mixed data: includes early calls made before translation was working and
before the language direction was flipped, so turn-around times include confused
pauses and unscripted conversation.

| Combo | Tier | Sessions | Turns | Turn-around avg (p95) | Translate avg | Quality (by ear) |
|---|---|---|---|---|---|---|
| 1 | Polly Generative | 4 | 19 | 6.7 s (10.2 s) | 339 ms | *(not yet noted)* |
| 2 | Polly Neural | 2 | 8 | 3.2 s (4.6 s) | 587 ms | *(not yet noted)* |
| 3 | Polly Standard | 2 | 7 | 1.9 s (3.0 s) | 751 ms | *(not yet noted)* |

Directionally this matches expectations — Standard is the fastest tier and
Generative the slowest — but the gaps are exaggerated by the messy early calls.
Raw events archived in `local-server/test-results-run1.jsonl`.

## Run 2 — clean run (2026-06-11, translation verified working, es↔en)

Protocol: short conversational calls, caller in Spanish, agent in English.

| Combo | Tier | Sessions | Turns | Turn-around avg (p95) | Translate avg | Quality (by ear) |
|---|---|---|---|---|---|---|
| 1 | Polly Generative | 1 | 5 | 6.2 s (8.4 s) | 183 ms | Best of Polly, but still feels robotic next to ElevenLabs |
| 2 | Polly Neural | 1 | 6 | 5.2 s (7.6 s) | 119 ms | Robotic feel |
| 3 | Polly Standard | 1 | 5 | 6.3 s (9.6 s) | 121 ms | Robotic |
| 4 | ElevenLabs Flash v2.5 | 1 | 8 | **3.5 s (5.7 s)**, fastest turn 0.95 s | 121 ms | **Feels like an actual human talking** |

## Verdict

- **Measured latency: no decisive winner.** Turn-around averages landed within
  ~1 s of each other (5.2–6.3 s) across tiers, and with only 5–6 turns per combo
  that spread is dominated by human reply speed, not TTS. The TTS tier
  contributes at most a few hundred ms either way. The rough run-1 data hinted
  Standard is fastest and Generative slowest, which matches published benchmarks.
- **Translate hop is a non-factor:** 119–183 ms regardless of tier (AWS
  Translate, after the first-call connection warmup).
- **Cost is identical** ($0.07/min flat through Twilio), so the decision comes
  down entirely to voice quality by ear.
- **Among Polly tiers:** Generative sounded the best (Neural fine, Standard
  robotic), and tier latency differences were inside human-reply noise — so
  within AWS, Generative was the right default.
- **Final winner: ElevenLabs Flash v2.5.** Tested as combo 4 after the Polly
  run: ~2–3 s faster per turn than every Polly tier (3.5 s avg vs 5.2–6.3 s,
  fastest turn 0.95 s), sounded good by ear with fast voice switching, and
  costs the same flat $0.07/min through Twilio. Adopted as the new default
  (`CaJslL1xziwefCeTNzHv-flash_v2_5` caller / `UgBBYS2sOqTuMpoF3BR0-flash_v2_5`
  agent). Known caveat to watch in daily use: ElevenLabs can stumble on raw
  numbers/abbreviations (`elevenlabsTextNormalization` TwiML attribute is the
  fix if it shows up).

## Pipeline stage metrics

One conversation turn flows through three stages. What each one costs, from
this project's recorded calls (run 2) plus published benchmarks where the
websocket can't see inside Twilio:

| Stage | Provider | Measured in our calls | Published benchmark |
|---|---|---|---|
| 1. Speech → text | Deepgram nova-3 | Not directly observable (Twilio-side). Indirect signal: prompts/leg 2.5–4.0 (utterance splitting) | ~150–300 ms to transcript + ~1 s end-of-utterance detection |
| 2. Text → text (translate) | AWS Translate | **80–183 ms avg** (min 80 ms, p95 157–371 ms) — directly measured, the only stage our server times exactly | ~matches |
| 3. Text → speech | ElevenLabs Flash v2.5 | Inferred from turn-around: **~2–3 s faster per turn than every Polly tier** (3.5 s avg vs 5.2–6.3 s; fastest turn 952 ms) | ~75 ms model latency, ~290 ms real-world time-to-first-audio |
| (3 alt) | Polly Generative/Neural/Standard | Turn-around 5.2–6.3 s avg | ~100–600 ms first audio (unpublished officially) |

Reading it: translation is a rounding error (~0.12 s); the perceived delay in a
turn is dominated by STT end-of-utterance detection (~1 s) + TTS synthesis and
playback + the human reply. The TTS provider was the lever that moved the
total — switching Polly → ElevenLabs cut measured turn-around roughly in half.

## ElevenLabs sound quality metric

Voice quality has no instrument in this pipeline — the industry metric is blind
human preference (Elo, like chess ratings), plus our own ears:

- **Artificial Analysis TTS Arena (blind listener preference, mid-2026):**
  ElevenLabs Flash v2.5 ranks in the global top ~25 of ~80 models and is the
  **highest-ranked option available in ConversationRelay** — above Polly
  Generative (rank ~33), far above Polly Neural (Elo ~868, legacy tier).
- **Independent blind tests:** ElevenLabs picked #1 for naturalness (~4.8/5)
  in 2025–26 listening tests.
- **Our ears (this project):** "sounds good, switches fast" — preferred over
  Polly Generative (best Polly tier), which beat Neural ("fine") and Standard
  ("robotic").
- Per-call rubric for future voice auditions (score 1–5 each): naturalness /
  first-word delay feel / pronunciation of numbers & names / consistency
  between Spanish and English legs.

## Run 3 — full speed run (2026-06-12, 3 cycles × 5 combos, ~115 turns)

Full AWS pipeline on every turn; cycle 3 also recorded sentence lengths,
enabling ms/char (turn-around ÷ characters the voice had to speak).

| Combo | Tier | Sessions | Turns | Turn-around avg (p95) | ms/char avg | Translate avg |
|---|---|---|---|---|---|---|
| 1 | Polly Generative | 3 | 21 | 11.5 s (24.2) | 206 | 145 ms |
| 2 | Polly Neural | 3 | 23 | 10.2 s (18.2) | 145 | 158 ms |
| 3 | Polly Standard | 3 | 22 | 10.7 s (19.1) | 223 | 174 ms |
| 4 | ElevenLabs Flash v2.5 | 3 | 23 | 11.7 s (17.8) | 179 | 172 ms |
| 5 | ElevenLabs Turbo v2.5 | 3 | 26 | 11.9 s (19.4) | 212 | 156 ms |

### Conclusions (supersede the run-2 latency claims)

1. **At natural conversation pace, the voice tier does not measurably change
   total turn latency.** All five tiers landed at 10–12 s per turn; even
   length-normalized ms/char values overlap with no stable ranking. Human
   speaking/thinking time dominates; sub-second TTS differences are below this
   instrument's noise floor.
2. **The run-2 "ElevenLabs halved turn-around" finding did not reproduce** —
   it was a single snappy conversation, not the voice. Treat published
   independent benchmarks (ElevenLabs Flash ~288 ms / Turbo ~264 ms TTFA) as
   the speed evidence; they remain the best available numbers.
3. **Translate hop definitively characterized:** 145–174 ms average across
   ~115 fully-real turns. A non-factor in perceived latency.
4. **Decision unchanged: ElevenLabs Flash v2.5 stays the default** — on
   quality (our ears + blind-test rankings) and published speed, not on our
   turn-around data. Turbo was indistinguishable by ear and is deprecated.

Raw events: `local-server/test-results.jsonl` (runs 1–2 archived as
`test-results-run1.jsonl` / `test-results-run2.jsonl`).

### Cycle 3 isolated (the only cycle with sentence-length tracking)

| Combo | Tier | Turns | Turn-around avg (p95) | ms/char avg (min–p95) | Avg sentence | Translate avg |
|---|---|---|---|---|---|---|
| 1 | Polly Generative | 6 | 17.3 s (24.2) | 206 (108–398) | 86 chars | 188 ms |
| 2 | Polly Neural | 10 | 9.7 s (17.7) | 145 (29–236) | 56 chars | 170 ms |
| 3 | Polly Standard | 9 | 12.3 s (19.1) | 223 (120–348) | 63 chars | 197 ms |
| 4 | ElevenLabs Flash v2.5 | 9 | 11.2 s (17.2) | 179 (90–292) | 64 chars | 148 ms |
| 5 | ElevenLabs Turbo v2.5 | 10 | 12.5 s (18.6) | 212 (77–437) | 70 chars | 182 ms |

The normalization demonstrably corrects the sentence-length confound (combo 1's
long sentences explain its 17 s raw average; ms/char puts it mid-pack). The
tier ranking still does not stabilize at 6–10 turns per combo — per-turn spread
is 3–4×, so human reply variation dominates differences this small. Quality by
ear remains the deciding metric.

## Extracted metrics (post-hoc analysis of recorded data)

**Fragmentation (choppiness):** 3.5–4.3 utterance fragments per leg per call,
flat across all five voice tiers — expected, since transcription (Deepgram
nova-3) was constant. This sets the baseline (~3.8) that a Deepgram Flux
experiment would aim to lower.

**Direction asymmetry:** none. es→en 162 ms avg (53 turns), en→es 160 ms avg
(62 turns). AWS Translate is symmetric.

**Translation quality (74 unique pairs reviewed from call logs):** accurate and
natural in both directions; numbers and place references handled correctly.
Two defects observed:
1. Spanish questions phrased without explicit question structure translate as
   statements ("¿Me puedes ayudar...?" → "You can help me…"), losing intent.
2. Speaking English on the Spanish-configured leg produces garbled transcripts
   that pass through mangled — monolingual STT config can't code-switch.
   Deepgram nova-3 supports a `multi` language mode that targets exactly this.
