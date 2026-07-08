## Why

When the agent endpoint is an ACD/queue (e.g. Webex Contact Center), the outbound agent call is **auto-answered into the queue before a human is on the line**. Treating "answered" as "agent ready" bridges the caller to an empty queue — translation starts against nobody and the caller hears filler. The middleware already solves this with an **accept gate** (hold the caller, wait for the human agent to press a key, then bridge), and it has been verified on a live call — but the behavior is undocumented as a spec. This change formalizes the existing, shipped behavior into an OpenSpec capability so it is contract-tested and safe to evolve. No runtime behavior changes.

## What Changes

- Capture the existing accept-gate behavior as a formal capability spec, sourced from `local-server/server.mjs` and `local-server/hold-music.mjs`:
  - Gate on agent-leg connect: when `AGENT_ACCEPT_DTMF=true`, mark the agent leg `awaitingAccept` and **do not bridge**; keep the caller on hold music.
  - Self-correlating DTMF accept: a keypress on the agent leg's own WebSocket bridges that leg to its already-linked caller (no phone-number lookup).
  - Repeating agent whisper that announces the caller's number digit-by-digit until accepted.
  - Optional out-of-band HTTP accept (`/v1/call-answered`) targeted by `callerAni`, or the single waiting call when none is given (409 if several, 404 if none).
  - No-answer timeout: caller hears an apology and the leg is ended (owned by hold-music).
  - Speech is ignored (`onHold` / `awaitingAccept`) so no "configuring translation" filler is sent before bridging.
- No code changes. This is a documentation/spec-formalization change; the spec describes current behavior exactly.

## Capabilities

### New Capabilities
- `agent-accept-gate`: Holds the caller and defers bridging until a real human agent signals readiness (in-band DTMF keypress, or out-of-band HTTP accept), with a self-correlating accept signal, a repeating number-announcing whisper, and a no-answer timeout.

### Modified Capabilities
<!-- None. There are no existing specs in openspec/specs/; this is the first capability captured. -->

## Impact

- **Specs**: adds `openspec/specs/agent-accept-gate/spec.md` (on sync).
- **Code (described, not modified)**: `local-server/server.mjs` (`bridgeLegs`, `handleDtmf`, `startAgentWhisper`/`clearAgentWhisper`, `findAwaitingByAni`, `listAwaiting`, the `callee` setup branch, `/v1/call-answered`), `local-server/hold-music.mjs` (no-answer timeout).
- **Config (described)**: `AGENT_ACCEPT_DTMF`, `AGENT_ACCEPT_DIGIT`, `AGENT_ACCEPT_REPEAT_MS`, `HOLD_TIMEOUT_MS`, `HOLD_TIMEOUT_MESSAGE`; enabling the gate also flips `dtmfDetection: "true"` on the agent leg's ConversationRelay TwiML.
- **No** API/runtime behavior change; no breaking changes.
