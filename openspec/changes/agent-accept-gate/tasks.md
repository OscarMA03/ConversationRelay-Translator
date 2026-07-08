## 1. Confirm code matches the spec

- [x] 1.1 Verify the gate: `callee` setup with `AGENT_ACCEPT_DTMF=true` sets `awaitingAccept`, does not bridge, keeps hold music, starts the whisper (`local-server/server.mjs` ~L352-371)
- [x] 1.2 Verify the gate-off path: `AGENT_ACCEPT_DTMF` unset bridges immediately on `callee` connect
- [x] 1.3 Verify `handleDtmf` bridges only on the accept digit and only when `awaitingAccept`, and is self-correlating via `targetConnectionId` (~L471-488)
- [x] 1.4 Verify `startAgentWhisper`/`clearAgentWhisper`: repeats every `AGENT_ACCEPT_REPEAT_MS`, announces `spokenPhone(callerPhone)` digit-by-digit, stops when not awaiting (~L429-469)
- [x] 1.5 Verify `/v1/call-answered`: by-number bridges exact match (404 if none); no-number bridges only when exactly one awaiting (409 otherwise) (~L702-740)
- [x] 1.6 Verify the no-answer timeout in `local-server/hold-music.mjs` (`holdTimeoutTimer`, `HOLD_TIMEOUT_MS`, apology, end leg) and that `clearHoldMusic` cancels it on bridge
- [x] 1.7 Verify `handlePrompt` ignores speech while `onHold` or `awaitingAccept` (no filler) (~L490-500)
- [x] 1.8 Verify caller-hangup cleanup ends the awaiting agent leg and stops its whisper (~L570-573)

## 2. Close test-coverage gaps

- [x] 2.1 Add a unit test: gate enabled defers bridge and sets `awaitingAccept`; gate disabled bridges immediately
- [x] 2.2 Add a unit test: accept digit bridges the correct linked caller; wrong digit / non-awaiting leg is ignored
- [x] 2.3 Add a unit test: two concurrent awaiting legs each bridge only their own caller (no collision)
- [x] 2.4 Add a unit test: whisper text with and without a known caller number, and that it stops on accept
- [x] 2.5 Add a unit test: `/v1/call-answered` matrix — match, no-match (404), single waiting, zero/multiple waiting (409) — covered at the decision layer (`findAwaitingByAni`/`listAwaiting`); HTTP status wiring stays in `server.mjs`
- [x] 2.6 Add a unit test: no-answer timeout apologizes and ends the caller leg — already covered by `hold-music.test.mjs` ("at the timeout it apologizes, then ends the call")
- [x] 2.7 Run the test suite and confirm green (73/73 pass)

## 3. Sync and archive

- [x] 3.1 Run `/opsx:sync agent-accept-gate` to merge the delta into `openspec/specs/agent-accept-gate/spec.md`
- [x] 3.2 Cross-check `docs/agent-accept-gate.md` and `docs/SOLUTION-BRIEF.md` against the synced spec; reconcile the `AGENT_WHISPER_REPEAT_MS` vs `AGENT_ACCEPT_REPEAT_MS` naming note
- [ ] 3.3 Archive the change once verification and tests pass
