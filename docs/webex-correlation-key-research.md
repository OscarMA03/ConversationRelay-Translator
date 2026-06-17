# Webex Side — Correlation Key Transport (open questions + decision guide)

Companion to `twilio-correlation-key-research.md` and `retell-correlation-key-research.md`.
This covers the **Webex → middleware** hop for the Spanish-translation flow, where the
`AgentAnswer` node in Flow Designer must tell the middleware *which* active call
session to activate.

## The problem, stated

- The middleware holds N active call sessions. When a human agent answers, the
  Webex `AgentAnswer` node fires an `HTTPRequest` to the middleware
  (e.g. `GET /v1/call-answered?<correlationKey>`).
- **It needs a correlation key that identifies the caller's session.**
- The call-center voice-agent product reuses the Webex flow's **`interactionId`**
  (after a first-pass phone-number correlation). That does **not** work here:
  Spanish translation uses **two separate Webex flows** (caller-side and
  agent-side) → **two unrelated `interactionId`s** → nothing to join on.

## The only identifier shared across both flows is the caller's phone number

So the pragmatic key is **`callerAni`** (caller's E.164 number). The middleware
already stores it as the caller leg's `From` / `SortKey` (`callerContext` in
`local-server/server.mjs`), so the lookup is:

```
GET /v1/call-answered?callerAni=+16195764744
  → find the caller session whose From == callerAni (normalized, still awaiting)
  → bridgeLegs()  (same path the DTMF accept gate uses)
```

This is exactly Twilio's recommended PSTN fallback (per the Twilio research doc):
*upstream POSTs context out-of-band, middleware matches on From + To + time.*

## THE decision that changes everything: can Webex egress as SIP?

| | **SIP path (preferred)** | **PSTN-only path (fallback)** |
|---|---|---|
| Correlation key | A real, unique `X-Correlation-Id` we generate, carried end-to-end | `callerAni` + `To` + time window |
| Robustness | High — unique per call, no collisions | Medium — see failure modes below |
| Middleware lookup | Exact key match | Fuzzy match on normalized phone number |
| Depends on | Webex can SIP into a Twilio SIP Domain **and** stamp a per-call header/UUI | Nothing extra — works over plain phone calls |

If SIP is possible, the whole phone-number problem disappears (see the end-to-end
SIP diagram in the Twilio doc).

## Questions to ask the Webex / telephony team

1. **SIP egress:** Can Webex Calling send this call out as **direct SIP** to an
   arbitrary SIP domain (Twilio's `*.sip.twilio.com`) — not via a PSTN/BYOC trunk?
2. **Custom header:** If yes, can the flow **stamp a per-call custom header**
   (`X-Correlation-Id: <uuid>`) or **User-to-User (UUI)** on the outbound INVITE?
   (Twilio surfaces `X-*` as `SipHeader_X-*` webhook params; BYOC trunks discard them.)
3. **Caller ANI visibility (critical for the PSTN fallback):** In the **agent-side**
   flow, is the **original caller's ANI** available as a variable? When the middleware
   dials the agent today, Webex sees the **Twilio number** as caller ID, *not* the
   caller — so confirm whether the agent flow can actually read the caller's number
   at all. If it can't, ANI-correlation can't even start until we deliver the number
   to Webex some other way.
4. **Out-of-band timing:** Does `AgentAnswer` fire its `HTTPRequest` **only when a
   human accepts**, or also when the queue/ACD auto-answers? (We need the human event.)
5. **Number format:** What format does Webex put the ANI in (E.164 `+1…`, 10-digit,
   national)? Determines our normalization.

## Failure modes of the phone-number fallback (must be handled)

1. **Same-ANI collision** — two concurrent calls from one number. Match on
   **From + To + time**, only consider sessions still `awaitingAccept`/`onHold`, and
   prefer the most recent. A **DID pool** (a dedicated Twilio number per concurrent
   session → key = which number was dialed) removes this entirely if collisions are real.
2. **Normalization mismatch** — `+16195764744` vs `6195764744` vs `(619) 576-4744`.
   Normalize both sides to E.164 before comparing.
3. **Withheld / blocked caller ID** — no ANI, no key. Needs a fallback (DID pool or
   reject).
4. **Race** — the POST must arrive while the session is live and waiting. Use a
   bounded time window.

## What we can build regardless of the answer

The middleware endpoint is the same shape either way — only the **key source** differs:

```
GET /v1/call-answered?<key>     # key = callerAni  OR  correlationId
  → resolve the awaiting caller session
  → bridgeLegs(agentLeg, callerLeg)   # stop hold music, start translation
```

It would **replace or complement the DTMF accept gate** (`AGENT_ACCEPT_DTMF`), and is
strictly better than DTMF where Webex might swallow the keypress.

## Recommendation

1. Get answers to Q1–Q3 above. **Q1/Q2 = yes** → go SIP + `X-Correlation-Id`; stop here, it's solved.
2. **Q1/Q2 = no** → PSTN fallback with `callerAni`, but **Q3 is the gate**: confirm the
   agent flow can see the caller's ANI. If it can't, first solve "get the caller's
   number to the agent side" (same root as the caller-ID-display question).
3. Either way, the middleware exposes one `/v1/call-answered` endpoint reusing
   `bridgeLegs()`; the key it reads is the only thing that changes.
