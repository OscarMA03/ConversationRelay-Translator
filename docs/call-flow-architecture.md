# Translation Call Flow — Architecture & Diagrams

How a Spanish↔English translated call moves through Webex Contact Center, Twilio,
and the AT middleware (this `local-server`). Reflects what's built as of the
`testing-branch` work.

## Participants

| Name | What it is |
|------|-----------|
| **Customer** | The inbound caller (e.g. Spanish speaker) |
| **WxCC Flow 1** | Webex flow on the **caller** side (`NewContact → Menu → BridgedTransfer`) |
| **Twilio** | Carries the call; runs ConversationRelay (the translation transport) |
| **AT Middleware** | Our server — bridges the two legs, runs translation, holds session state |
| **WxCC Flow 2** | Webex flow on the **agent** side (`NewPhoneContact → QueueContact`) |
| **Agent / User** | The person who takes the call (English speaker) |

---

## Sequence diagram (timeline)

```mermaid
sequenceDiagram
    autonumber
    actor Cust as Customer (Spanish)
    participant F1 as WxCC Flow 1 (caller)
    participant TW as Twilio
    participant MW as AT Middleware
    participant F2 as WxCC Flow 2 (agent)
    actor Agent as Agent / User (English)

    Cust->>F1: Calls in
    F1->>Cust: Menu: "Press 1 for English, 2 for Spanish"
    Cust->>F1: Chooses Spanish
    Note over F1: Spanish → translation path<br/>(English → normal routing, no translation)
    F1->>MW: POST /v1/register (callerAni, interactionId)
    Note over MW: Cache session — status = waiting
    F1->>TW: BridgedTransfer → Twilio number (PSTN)
    TW->>MW: POST /twiml/inbound → ConversationRelay TwiML
    TW-->>MW: Caller leg WebSocket (setup)
    Note over MW: Auto-register caller (waiting)<br/>▶ start hold music 🎵
    MW->>TW: REST API: dial the agent
    TW->>F2: Agent call rings (NewPhoneContact)<br/>ANI = Twilio number (not customer's)
    F2->>MW: GET /v1/next-waiting (or /v1/status)
    MW-->>F2: callerAniDisplay, interactionId
    Note over F2: Set user_phone_number<br/>Screen Pop / show number
    F2->>Agent: QueueContact → ring the user
    TW-->>MW: Agent leg WebSocket (setup)
    Note over MW: awaiting accept<br/>🎵 music + "press 1" whisper
    alt Agent accepts
        Agent->>MW: Presses 1 (DTMF, on this leg)
    else HTTP trigger
        F2->>MW: POST /v1/call-answered
    end
    Note over MW: bridgeLegs() — status = activated, stop music
    loop Live call
        Cust->>MW: speaks Spanish
        MW->>Agent: translated → English (AWS Translate)
        Agent->>MW: speaks English
        MW->>Cust: translated → Spanish
    end
```

---

## Flowchart (branches & decisions)

```mermaid
flowchart TD
    A([Customer calls in]) --> B[WxCC Flow 1]
    B --> M{Menu: language?<br/>1 = English · 2 = Spanish}
    M -->|English| EN[Route to English agent<br/>no translation]
    M -->|Spanish| C[/POST /v1/register<br/>cache caller# + interactionId<br/>status = waiting/]
    C --> D[BridgedTransfer → Twilio number]
    D --> E[Twilio: POST /twiml/inbound<br/>returns ConversationRelay TwiML]
    E --> F[Caller leg WebSocket connects]
    F --> G[Middleware: auto-register caller waiting<br/>▶ start hold music 🎵 + repeating reassurance line]
    G --> H[Middleware dials the agent<br/>via Twilio REST API]
    H --> I[Agent call rings WxCC Flow 2<br/>ANI = Twilio number]
    I --> J[/Flow 2: GET /v1/next-waiting<br/>→ caller# + interactionId/]
    J --> K[Set user_phone_number<br/>Screen Pop shows the number]
    K --> L[QueueContact → ring the user]
    L --> M[Agent leg WebSocket connects<br/>status: awaiting accept<br/>🔁 whisper 'press 1' to agent]
    M --> N{Accepted within 45s?}
    N -->|Press 1 DTMF<br/>OR POST /v1/call-answered| O[bridgeLegs<br/>status = activated<br/>⏹ stop music]
    N -->|No answer / timeout| P[Apologize to caller<br/>end caller + agent legs]
    O --> Q[[Live translated call<br/>ES ⇄ EN via AWS Translate]]
    Q --> R{Either party<br/>hangs up?}
    R -->|yes| S[Disconnect both legs<br/>clear timers]
    R -->|no| Q
    P --> S
    S --> T([Call ended])
```

---

## Option 3 (future) — beep the number in via DTMF

To give Flow 2 the **real per-call key** over PSTN (no FIFO guessing), the
middleware can send the caller's number as DTMF tones on the agent leg, and
Flow 2 collects them:

```mermaid
flowchart LR
    A[Agent leg connects] --> B[Middleware: sendDigits<br/>'6195764744#' on the agent leg]
    B --> C[Twilio plays the tones into the call]
    C --> D[Flow 2: Collect Digits node<br/>captures the number]
    D --> E[/Flow 2: GET /v1/status?callerAni=number/]
    E --> F[Exact match — correct at any scale]
```

---

## The hold experience (while waiting for the agent)

```mermaid
flowchart TD
    A[Caller on hold] --> B[🎵 music loops]
    B --> C[~10s: speak reassurance line<br/>in caller's language]
    C --> D[~7s pause for the line]
    D --> E[🎵 music resumes]
    E --> F{Agent accepted?}
    F -->|no, < 45s| C
    F -->|no, 45s| G[Apology + hang up]
    F -->|yes| H[Stop music, bridge]
```

---

## Why the `register` / `next-waiting` dance exists

The core constraint: **Flow 1 knows the customer's number; Flow 2 does not.**
When the middleware dials the agent, Twilio blocks using the customer's number as
caller ID (error 21210), so Flow 2 only sees the **Twilio number** — identical for
every call. The registry carries the number across the gap:

- **Reliable at any scale:** `Press 1` (DTMF) — the keypress arrives on that call's
  own connection, already linked to its caller. Self-correlating.
- **Best-effort (low volume):** `GET /v1/next-waiting` — hands out the oldest
  waiting caller (FIFO). Can mis-pair under many simultaneous parallel pickups.
- **The clean long-term fix:** SIP/UUI (a unique correlation header per call) — see
  `webex-correlation-key-research.md`.

---

## Endpoint reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/twiml/inbound` | POST | Twilio voice webhook → ConversationRelay TwiML |
| `/ws` | WS | ConversationRelay WebSocket (caller & agent legs) |
| `/v1/register` | GET/POST | Cache a session `{callerAni, id}` — status `waiting` |
| `/v1/status` | GET | Is this call `activated`? Returns the cached entry |
| `/v1/next-waiting` | GET | FIFO: oldest waiting caller (`?claim=true` to advance) |
| `/v1/call-answered` | GET/POST | Activate/bridge a call (by `callerAni`, or the single waiting one) |
| `/sessions` | GET | Debug view: live connections + registry |
| `/last-inbound` | GET | Last few inbound webhook payloads (correlation research) |

Responses include `callerAni`, `callerAniE164` (`+16195764744`) and
`callerAniDisplay` (`(619) 576-4744`).
```
