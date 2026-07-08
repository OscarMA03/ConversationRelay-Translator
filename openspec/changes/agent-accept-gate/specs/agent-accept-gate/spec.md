## ADDED Requirements

### Requirement: Defer bridging until the agent accepts

When the accept gate is enabled (`AGENT_ACCEPT_DTMF=true`), the system SHALL NOT bridge the caller and agent legs when the agent call is answered. It SHALL instead mark the agent leg as awaiting accept, keep the caller on hold music, and wait for an explicit accept signal.

#### Scenario: Agent leg connects with the gate enabled

- **WHEN** the agent (`callee`) leg's WebSocket setup completes and `AGENT_ACCEPT_DTMF` is `true`
- **THEN** the system marks that leg `awaitingAccept = true`
- **AND** does not bridge the two legs
- **AND** the caller remains on hold music
- **AND** starts the repeating agent whisper

#### Scenario: Agent leg connects with the gate disabled

- **WHEN** the agent (`callee`) leg's WebSocket setup completes and `AGENT_ACCEPT_DTMF` is not `true`
- **THEN** the system bridges the agent leg to its linked caller immediately

#### Scenario: Caller leg missing at agent connect

- **WHEN** the agent leg connects but its linked caller leg cannot be found
- **THEN** the system informs the agent leg that the caller could not be found
- **AND** does not bridge

### Requirement: Self-correlating in-band DTMF accept

The system SHALL accept the call when the human agent presses the configured accept digit (default `1`, `AGENT_ACCEPT_DIGIT`) on the agent leg. Because the keypress arrives on the agent leg's own WebSocket — which was linked to its caller at dial time — the accept SHALL be correlated to the correct caller without any phone-number lookup. On accept, the system SHALL bridge that agent leg to its linked caller.

#### Scenario: Agent presses the accept digit

- **WHEN** a DTMF message arrives on an agent leg that is `awaitingAccept` and the digit equals the configured accept digit
- **THEN** the system bridges that agent leg to its linked caller
- **AND** stops the caller's hold music and the agent whisper
- **AND** activates translation in both directions

#### Scenario: Keypress that is not the accept digit

- **WHEN** a DTMF message arrives on an `awaitingAccept` agent leg but the digit is not the accept digit
- **THEN** the system ignores it and the leg stays awaiting accept

#### Scenario: Keypress on a leg that is not awaiting accept

- **WHEN** a DTMF message arrives on a leg that is not `awaitingAccept`
- **THEN** the system ignores it

#### Scenario: Concurrent accepts do not collide

- **WHEN** two different agent legs each press the accept digit
- **THEN** each accept bridges only its own linked caller, with no cross-correlation between sessions

### Requirement: Repeating agent whisper announcing the caller

While an agent leg is awaiting accept, the system SHALL repeatedly prompt the agent to press the accept digit and SHALL announce the caller's phone number digit-by-digit so a late-joining human hears it. The whisper SHALL repeat every `AGENT_ACCEPT_REPEAT_MS` (default 15000 ms) and SHALL stop once the leg is no longer awaiting accept.

#### Scenario: Whisper announces a known caller number

- **WHEN** an agent leg is awaiting accept and the caller's number is known
- **THEN** the whisper announces the incoming call with the number read digit-by-digit and instructs the agent to press the accept digit

#### Scenario: Whisper without a caller number

- **WHEN** an agent leg is awaiting accept and the caller's number is not known
- **THEN** the whisper states that a translated call is waiting and instructs the agent to press the accept digit

#### Scenario: Whisper stops after accept

- **WHEN** the agent leg is no longer awaiting accept (accepted, hung up, or timed out)
- **THEN** the system stops repeating the whisper

### Requirement: Out-of-band HTTP accept

The system SHALL provide an HTTP endpoint (`/v1/call-answered`) that bridges a waiting call without an in-band keypress. When a caller number is supplied, it SHALL bridge exactly the awaiting agent leg whose caller matches. When no number is supplied, it SHALL bridge only when exactly one call is awaiting, and SHALL refuse to guess otherwise.

#### Scenario: HTTP accept targeted by caller number

- **WHEN** `/v1/call-answered` is called with a caller number that matches an awaiting agent leg
- **THEN** the system bridges that leg and returns success

#### Scenario: HTTP accept targeted by an unknown number

- **WHEN** `/v1/call-answered` is called with a caller number that matches no awaiting leg
- **THEN** the system returns a 404 and does not bridge

#### Scenario: HTTP accept with no number and a single waiting call

- **WHEN** `/v1/call-answered` is called with no caller number and exactly one call is awaiting
- **THEN** the system bridges that one call and returns success

#### Scenario: HTTP accept with no number and multiple waiting calls

- **WHEN** `/v1/call-answered` is called with no caller number and zero or more than one call is awaiting
- **THEN** the system returns a 409 and does not bridge

### Requirement: No-answer timeout

If no accept signal arrives within the hold timeout (`HOLD_TIMEOUT_MS`, default 45000 ms), the system SHALL stop the hold music, play an apology to the caller, and end the caller leg.

#### Scenario: No one accepts within the timeout

- **WHEN** the hold timeout elapses with the agent leg still awaiting accept
- **THEN** the system stops the hold music, plays the apology message to the caller, and ends the caller leg

### Requirement: Suppress filler speech while gated

While the caller is on hold or the agent leg is awaiting accept, the system SHALL ignore inbound speech on that leg and SHALL NOT send the "configuring translation" filler before the call is bridged.

#### Scenario: Speech arrives before bridging

- **WHEN** a speech prompt arrives on a leg that is on hold or awaiting accept
- **THEN** the system ignores it and sends no reply

### Requirement: Clean up on caller hangup while awaiting accept

If the caller hangs up (or the leg ends) while its agent leg is still awaiting accept, the system SHALL stop the agent whisper and end the agent leg.

#### Scenario: Caller hangs up before the agent accepts

- **WHEN** the caller leg disconnects while its agent leg is awaiting accept
- **THEN** the system stops the agent whisper and ends the agent leg
