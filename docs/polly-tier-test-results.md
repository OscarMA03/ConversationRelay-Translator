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
| 1 | Polly Generative | 1 | 5 | 6.2 s (8.4 s) | 183 ms | *(awaiting notes)* |
| 2 | Polly Neural | 1 | 6 | 5.2 s (7.6 s) | 119 ms | *(awaiting notes)* |
| 3 | Polly Standard | – | – | – | – | – |

## Verdict (pending run 2)

*(to be filled in after the clean run)*
