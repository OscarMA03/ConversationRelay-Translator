# Voice Provider Test Mode — Design

**Date:** 2026-06-11
**Goal:** Let two testers compare every Amazon Polly voice tier available through
Twilio ConversationRelay (Generative, Neural, Standard) on real two-party calls,
with auto-rotating combos and per-call timing measurements.

## Background

This app sets `transcriptionProvider`, `ttsProvider`, and `voice` per call leg in
the ConversationRelay TwiML (`local-server/server.mjs`). Twilio runs the speech
providers on its side at a flat $0.07/min, so switching combos has no cost or
account implications. ConversationRelay offers no AWS option for speech-to-text
(only Deepgram and Google), so STT stays pinned at Deepgram nova-3 — the only
variable across combos is the Polly TTS tier.

Twilio never exposes raw provider timings (speech-start or playback timestamps)
to the websocket server. Metrics are therefore *relative* proxies computed from
websocket message timestamps, meaningful when testers follow the same call
script across combos; voice quality is judged by ear.

## Combo matrix

| # | STT | TTS (both legs) | Caller voice (en-US) | Agent voice (es) |
|---|-----|-----------------|----------------------|------------------|
| 1 | Deepgram nova-3 | Polly Generative (baseline) | `Matthew-Generative` | `Lupe-Generative` |
| 2 | Deepgram nova-3 | Polly Neural | `Matthew-Neural` | `Lupe-Neural` |
| 3 | Deepgram nova-3 | Polly Standard | `Matthew` | `Lupe` |

Both legs of a session use the same combo. The matrix lives in one exported
array so future rows (ElevenLabs, Google, Deepgram flux) are one-line additions.

## Components

### `local-server/combos.mjs` (new)

- `COMBOS` — the matrix above; each entry: `{ id, label, transcriptionProvider,
  speechModel, ttsProvider, callerVoice, agentVoice }`.
- `getCombo(id)` — lookup with a helpful error listing valid ids.
- `nextCombo()` — in-memory rotation across caller sessions; if `TEST_COMBO` is
  set in the environment, always returns that combo (pinning).
- No I/O; fully unit-testable.

### `local-server/stats.mjs` (new)

- `computeStats(samples)` → `{ min, avg, p95 }` or `null` for empty input.
  (Same helper the translation-benchmark plan specifies; shared going forward.)

### `local-server/metrics.mjs` (new)

Pure functions over recorded timing events:

- `recordEvent(session, event)` shape: `{ ts, sessionId, comboId, leg,
  direction: 'in'|'out', type, chars? }`.
- `summarize(events)` → per-combo: session count, turn count, and stats for:
  - **translate latency** — `prompt` received → `text` sent to the other leg
    (our own hop; sanity check that it is combo-independent),
  - **turn-around time** — `text` sent to leg B → next `prompt` received from
    leg B (includes TTS synthesis + playback + listener response + STT +
    endpointing; the cross-combo differentiator under a fixed script),
  - **utterance fragmentation** — `prompt` messages per leg per session
    (endpointing quality).

### `server.mjs` changes

- When `PROVIDER_TEST_MODE=true`:
  - Each new caller session takes `nextCombo()`; both `callerContext()` and
    `agentContext()` use the combo's providers/voices instead of env defaults.
  - The caller welcome greeting announces the combo: "Test combo 2: Polly
    Neural voices." (Agent greeting unchanged.)
  - Every websocket message in/out is recorded via `metrics.recordEvent` and
    appended as JSON lines to `local-server/test-results.jsonl` (survives
    restarts; gitignored).
- New `GET /results` endpoint: per-combo summary JSON computed from
  `test-results.jsonl` (the single source of truth, so summaries span
  restarts and match `npm run report`).
- The TwiML builder gains a `speechModel` relay attribute (explicit
  `nova-3-general` now; required anyway for any future flux row).
- When `PROVIDER_TEST_MODE` is unset/false, behavior is byte-identical to today.

### `local-server/report.mjs` (new) + `npm run report`

Reads `test-results.jsonl`, prints a per-combo comparison table (sessions,
turns, translate latency, turn-around min/avg/p95, fragmentation) sorted by
combo id.

## Test protocol (documented in `docs/voice-provider-comparison.md`)

1. Set `PROVIDER_TEST_MODE=true`, start server + ngrok, both testers ready.
2. Call in 3 times (once per combo); the greeting announces which combo is live.
3. Both parties read the same short script each call; the listener replies
   immediately upon hearing each phrase (keeps turn-around comparable).
4. Note subjective quality per call: first-word delay, naturalness, number and
   name pronunciation.
5. `npm run report` for the timing table; pair it with the ear notes.

## Error handling

- Unknown `TEST_COMBO` value: server exits at startup with the valid id list.
- JSONL append failures are logged, never crash call handling.
- `/results` with no recorded events returns an empty summary, not an error.

## Testing

`node --test` units (no network, following `providers.test.mjs` conventions):
combo lookup/rotation/pinning (env stubbed), `computeStats`, and `summarize`
fed fixture event arrays covering multi-combo, multi-session, fragmented-turn,
and empty cases. Manual smoke: server starts with test mode on/off; `/results`
serves JSON.

## Out of scope

- ElevenLabs / Google TTS combos and Google/flux STT rows (one-line additions
  later if wanted).
- Echo/solo test mode (testing is two-party per user decision).
- Changes to the deployed AWS Lambda stack — local server + ngrok only.
