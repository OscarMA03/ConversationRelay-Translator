# Retell API — Correlation Key Transport Research

Question: when a call is bridged into Retell, what data payloads are available, what
SIP information/headers are there, and what transport mechanisms exist as an
alternative to phoneNumber for the correlationKey?
(Verified against docs.retellai.com and the retell-sdk source, June 2026.
Companion doc: `twilio-correlation-key-research.md`.)

## 1. The payloads available when a call bridges in

Three observation points, in time order:

### a. Inbound Call Webhook — fires BEFORE the agent answers (pre-answer routing)
```json
{
  "event": "call_inbound",
  "event_timestamp": 1780012672105,
  "call_inbound": {
    "agent_id": "agent_12345",
    "from_number": "+12137771234",
    "to_number": "+12137771235",
    "custom_sip_headers": {
      "x-my-header": "my-value",
      "user-to-user": "616263;encoding=hex"
    }
  }
}
```
- No `call_id` yet (the call object doesn't exist at this point)
- `custom_sip_headers` carries **`X-*` headers PLUS an allowlist of standard headers:
  `User-to-User`, `Diversion`, `History-Info`, `P-Asserted-Identity`**
- The 2xx **response is an injection point**: `override_agent_id`, `dynamic_variables`,
  `metadata`, `agent_override` — all applied to this call only
- 10 s timeout, 3 retries; on total failure falls back to the number's bound agent
- Only fires for Retell-managed/imported numbers (NOT for register+dial custom telephony,
  where the middleware is already in charge)

### b. `call_started` webhook — full call object at answer
Payload is `{event, call}` where `call` is the same object as Get Call. Signature:
`x-retell-signature` = `v={ts_ms},d={hmac}`, HMAC-SHA256(raw_body + ts, api_key),
5-min replay window. SDK: `Retell.verify(rawBody, apiKey, signature)` /
`client.verify(...)` (Python). Retell egress IP: `100.20.5.228`.

### c. Get Call API / `call_ended` / `call_analyzed` — the complete call object
Fields relevant to correlation:

| Field | Notes |
|---|---|
| `call_id` | Retell's own id; also the dial-in address in custom telephony |
| `from_number`, `to_number`, `direction` | the phoneNumber channel (today's key) |
| `metadata` | arbitrary JSON, ≤50 kB, storage-only, echoed in every webhook |
| `retell_llm_dynamic_variables` | string map, injected into prompt/tools/URLs |
| `collected_dynamic_variables` | post-call; **inbound X-headers also land here, prefix-stripped** |
| `custom_sip_headers` | the extracted SIP headers (see §2) |
| **`telephony_identifier.twilio_call_sid`** | **Retell hands you the Twilio CallSid** (Twilio-path calls) — a free, no-smuggling join key between the two systems |
| `disconnection_reason`, `transfer_destination`, `call_analysis`, latency, transcript, recordings | post-call data |

## 2. SIP information available — and not available

**Extracted automatically, zero config, on every inbound SIP path** (Retell-purchased
numbers, Twilio elastic-trunk imported numbers, and register+dial custom telephony):

- All `X-*` / `x-*` headers → `call.custom_sip_headers` **and** auto-exposed as
  **dynamic variables with the prefix stripped** (`X-test-header` → `{{test-header}}`)
  — usable inside the agent prompt itself
- Allowlisted standard headers: `User-to-User` (UUI), `Diversion`, `History-Info`,
  `P-Asserted-Identity`
- Practical size guidance: keep header lines under ~1024 bytes (middlebox limit)

**Not available via API (dashboard PCAP downloads only):** the SIP `Call-ID`, raw
INVITE, SDP, source IPs. The SIP Call-ID is therefore *not* a programmatic
correlation key on the Retell side.

## 3. Transport mechanisms — alternatives to phoneNumber

Ranked for the middleware architecture:

### ① Register Phone Call + dial `sip:{call_id}@sip.retellai.com` — correlation by construction
The custom-telephony flow inverts the problem: the middleware **mints the Retell
`call_id` before the call ever bridges**:
1. `POST /register-phone-call` with `agent_id` + **`metadata` (put the correlationKey here)**
   + `retell_llm_dynamic_variables` (+ from/to/direction, stored for tracking only)
2. Response returns `call_id` synchronously → store correlationKey ↔ call_id
3. Dial `sip:{call_id}@sip.retellai.com` **within 5 minutes** (else
   `registered_call_timeout`)

No header smuggling needed at all — the key is attached at registration and echoed in
every subsequent webhook. Note: `custom_sip_headers` is *not* a register-call request
field; headers go on the SIP leg you dial (which still gets auto-extracted).

### ② X-headers / UUI on the inbound INVITE — works on every path
`sip:...@sip.retellai.com?X-Correlation-Id=abc` (or via elastic trunk): surfaces in
the inbound webhook (pre-answer), the call object, and as a prompt-usable dynamic
variable. UUI explicitly supported. This is the channel that pairs with Twilio's
`<Dial><Sip>` / REST `To=sip:...?X-...` mechanism.

### ③ Inbound-webhook echo — read headers, write context
For Retell-managed/imported numbers: read `custom_sip_headers` (or from/to) in the
`call_inbound` request, respond with `metadata` + `dynamic_variables`. Converts any
upstream signal into durable call-object context before the agent answers.

### ④ `telephony_identifier.twilio_call_sid` — the free join key
For Twilio-path calls Retell stores the **Twilio CallSid** on the call object. Even
with zero smuggling, middleware can join Retell call ↔ Twilio call ↔ its own session
state on CallSid alone. Worth verifying it populates on your specific path
(elastic-trunk import vs register+dial).

### ⑤ Allowlisted `Diversion` / `History-Info` / `P-Asserted-Identity`
If Webex's forwarding stamps these (even across hops), Retell captures them — a
possible "found" channel that needs empirical testing on a real Webex-forwarded call.

## 4. Getting data OUT of Retell (toward the call center)

- `custom_sip_headers` on Create Phone Call and on transfer tools (`X-*` or
  `User-To-User`; dynamic-variable substitution allowed — the agent can pass
  call-extracted data to the receiving party)
- **The documented Twilio gap:** cold transfer = SIP REFER, and *"Twilio does not
  honor the custom SIP headers in the REFER request."* Headers survive only when
  transferring **directly to a SIP endpoint**, and may be stripped toward PSTN.
  **Warm transfer uses SIP DIAL (a fresh INVITE) and does carry headers** — so for
  key-bearing handoffs through Twilio: warm transfer, direct SIP destination, or
  have the middleware re-dial instead of REFER.
- Webhooks out: `call_started/ended/analyzed` + transfer events all carry
  `metadata`/dynamic variables — the out-of-band path to the call center's systems.

## 5. Answer to the architecture question

**Yes — there are multiple Webex→Retell channels that replace phoneNumber, and they
compose with the Twilio findings:**

```
All-SIP path (cleanest):
Webex ──SIP X-Correlation-Id──► Twilio SIP Domain ──SipHeader_X-...──► middleware
  middleware ──register(metadata: key) → call_id──► dial sip:{call_id}@sip.retellai.com?X-Correlation-Id=...
    └─► Retell: key in metadata + custom_sip_headers + {{correlation-id}} in prompt
        + telephony_identifier.twilio_call_sid as a backup join
```

Even in the worst case (Webex PSTN-only into Twilio), the **Retell half is already
solved** by ① — the middleware mints the call_id and attaches whatever key it has.
The remaining gap is purely Webex→middleware (Twilio doc §2: SIP Domain headers, DID
pool, or out-of-band POST).

## Open items to verify empirically

1. Does `telephony_identifier.twilio_call_sid` populate on your exact path (trunk
   import vs register+dial)?
2. Do `Diversion`/`History-Info` arrive populated on a real Webex-forwarded call?
3. Log one real bridged call's `call_inbound` webhook + Get Call response and diff
   against this doc (Retell ships features faster than docs).
