## Context

The agent is reached through an ACD/queue (Webex Contact Center). When the middleware places the outbound agent call, the queue **auto-answers it immediately** to enqueue it — before a human is present. The naive "answered ⇒ ready" assumption bridged the caller to an empty queue: translation ran against nobody and the caller heard filler.

The behavior described here is **already implemented and verified on a live call**. It lives in `local-server/server.mjs` (the gate, DTMF accept, whisper, HTTP accept, bridge) and `local-server/hold-music.mjs` (no-answer timeout). This design records the decisions behind that shipped behavior so the spec is grounded; it does not introduce new code.

Each call session is a pair of private WebSocket connections — caller leg and agent (`callee`) leg — linked when the agent is dialed (`targetConnectionId = caller.pk`). There can be hundreds of concurrent sessions.

## Goals / Non-Goals

**Goals:**

- Hold the caller and defer bridging until a *human* agent signals readiness.
- Correlate the accept signal to the correct caller reliably at any concurrency.
- Keep the caller informed (hold music + reassurance) and the agent informed (who is calling) while waiting.
- Fail safe: time out a never-answered call; never bridge to the wrong caller.

**Non-Goals:**

- Carrying the customer's number to the agent's *screen* / caller-ID line (that is the separate correlation problem — SIP/UUI, SendDigits, or number pool; see `docs/SOLUTION-BRIEF.md`).
- Changing translation, hold-music, or session-registry behavior.
- Any code change — this change formalizes existing behavior as a spec.

## Decisions

**Decision: Gate on an in-band signal (DTMF keypress on the agent leg), not on call-answered.**
A keypress only happens when a human is present, and it arrives on that specific call's WebSocket — already linked to its caller. So `connectionId → party → targetConnectionId → caller` is a direct chain, never a guess. This sidesteps the correlation problem entirely for *accepting*.
*Alternatives considered:* (a) Bridge on answer — rejected: the queue auto-answers before a human is there. (b) Out-of-band HTTP "answered" keyed by caller number — kept as a secondary path (`/v1/call-answered`) but it needs a correlation key the agent-side flow lacks over PSTN, so it cannot be the primary trigger.

**Decision: Repeat the whisper and announce the caller number digit-by-digit.**
The human joins the queued call late, so a one-shot prompt would be missed; it repeats every `AGENT_ACCEPT_REPEAT_MS`. The number is built from digits and spliced in after localization so the translator cannot mangle it.

**Decision: HTTP accept refuses to guess.**
With a number it bridges the exact match (404 if none). Without a number it bridges only when exactly one call is awaiting, else 409. This preserves "never bridge to the wrong caller."

**Decision: No-answer timeout lives with the hold music.**
The hold-music module already owns the caller-facing timers, so the 45s apologize-and-hang-up (`HOLD_TIMEOUT_MS`) is one of its timers (`holdTimeoutTimer`), cleared by `clearHoldMusic` on bridge.

**Decision: Suppress speech while gated.**
While `onHold` or `awaitingAccept`, inbound prompts are ignored so the caller never hears the "configuring translation" filler before bridging.

## Risks / Trade-offs

- **Same-number collision in `findAwaitingByAni`** (two awaiting legs share a caller number) → the HTTP-by-number path takes the most-recent waiting leg; the in-band DTMF path is unaffected (self-correlating), which is why it is the reliable trigger.
- **Queue does not forward DTMF through to the middleware** → accept would never fire; mitigated by the HTTP accept path and the no-answer timeout. (Verified live that Webex does pass the keypress through.)
- **Whisper talk-over** the agent → repeat interval is configurable; default 15s.
- **Gate misconfigured for a direct-dial agent** (no queue) → with `AGENT_ACCEPT_DTMF=false` the system bridges immediately, preserving the non-queue path.

## Migration Plan

None — behavior already shipped and is feature-flagged by `AGENT_ACCEPT_DTMF` (default `false`). Enabling the gate also flips `dtmfDetection: "true"` on the agent leg's ConversationRelay TwiML so Twilio forwards `dtmf` messages. Rollback is setting the flag back to `false`.

## Open Questions

- Should `findAwaitingByAni` reject (rather than pick most-recent) on a same-number collision, given the in-band path is the intended primary trigger?
- Should the no-answer timeout be its own `AGENT_ACCEPT` setting rather than sharing `HOLD_TIMEOUT_MS`?
