# Twilio API — Correlation Key Transport Research

Question: within the middleware, what payload does Twilio give us, can we smuggle a
correlation key in, and what can we smuggle out to the call center?
(Verified against Twilio docs, June 2026. Retell side researched separately;
one directly relevant Retell fact included at the end.)

## 1. What the middleware receives from Twilio (inbound webhook payload)

Every inbound call fires the voice webhook with:

**Always:** `CallSid`, `AccountSid`, `From`, `To`, `CallStatus`, `Direction`, `ApiVersion`

**Best-effort geo (PSTN callers only):** `FromCity/State/Zip/Country`, `ToCity/...`

**Conditional:**
| Param | When |
|---|---|
| `ForwardedFrom` | Call was forwarded before reaching Twilio — populated from the Diversion header, **carrier-dependent and unreliable** |
| `CallerName` | Only with `VoiceCallerIdLookup` enabled (US CNAM, paid per lookup) |
| `CallToken` | Opaque Twilio token for preserving SHAKEN attestation when re-dialing — not usable as a custom channel |
| `StirVerstat` / `StirPassportToken` | SHAKEN/STIR attestation of the inbound call (trust signal, not a data channel) |
| `ParentCallSid` | Child legs only |

**Extra params when the call arrives via a Programmable Voice SIP Domain:**
`SipDomain`, `SipDomainSid`, `SipCallId` (the SIP Call-Id — itself a usable correlation
key if the upstream system records it), `SipSourceIp`, and — the important one —
`SipHeader_<name>` (see below).

**Not available anywhere:** the raw SIP INVITE. If a field isn't surfaced as a webhook
param at ring time, it cannot be recovered later — the Calls API doesn't return SIP
headers, and Voice Insights events are quality/progress metadata only.

## 2. Smuggling a key IN — it depends entirely on which Twilio front door

| Path into Twilio | Custom key channel | Verdict |
|---|---|---|
| **Programmable Voice SIP Domain** (`yourapp.sip.twilio.com`) | ✅ Any `X-*` header arrives as `SipHeader_X-...` webhook param. `User-to-User` (UUI) also passes. The SIP URI user-part (`sip:KEY@yourapp.sip.twilio.com`) works too, and `SipCallId` comes free | **The channel.** This is the only Twilio entry point that delivers upstream custom headers to the middleware |
| **BYOC trunk** | ❌ Webhook fires, but custom headers on the INVITE are **explicitly discarded** by Twilio | Dead end for headers |
| **Elastic SIP Trunking** | ❌ No webhook/TwiML layer at all — trunking is PSTN passthrough, not programmable | Wrong product for the middleware |
| **PSTN (plain call to a Twilio DID)** | ❌ No header survives the PSTN. In-band keys limited to: `From` (today's correlationKey), `To` (a **pool of dedicated DIDs** can encode the key), `ForwardedFrom` (unreliable) | Out-of-band correlation is Twilio's own recommended pattern here: upstream POSTs context to the middleware first, middleware matches on From+To+time |

**Architectural implication:** if Webex can deliver the call to Twilio **as SIP into a
Programmable Voice SIP Domain** (not a trunk), the correlation key rides in an
`X-Correlation-Id` header end-to-end and `phoneNumber` correlation disappears. If
Webex can only reach Twilio over the PSTN, no header trick exists — the realistic
alternatives are a DID pool (key = which number was dialed) or out-of-band POST + caller-ID match.

## 3. Smuggling a key OUT (to Retell or the call center)

### To any SIP destination — full support
- **TwiML:** `<Dial><Sip>sip:agent@host?X-Correlation-Id=abc123&User-to-User=...</Sip></Dial>`
- **REST API:** `POST /Calls` with `To=sip:agent@host?X-Correlation-Id=abc123`
- Limits: SIP URI < 255 chars; total headers < 1024 chars; URL-encode `; , =`
- `<Refer>` (SIP transfer) can also carry headers in the Refer-To URI — SIP legs only
- X-headers in the destination's 200 OK response surface back to the app (a return channel)

### To a PSTN call center — almost nothing
| Channel | Capacity | Notes |
|---|---|---|
| Caller ID (`From`) | ~1 phone number | Must be a Twilio-owned or verified number — so a **number pool is the key-space**; the call center's CTI pops on ANI |
| `SendDigits` (DTMF after answer) | ≤ 32 digits (`0-9*#ABCD`, `w/W` pauses) | The only true in-band data channel; works if the call center IVR can capture digits |
| CNAM | Static brand string | Pre-registered via Trust Hub, not per-call — not a key channel |
| SIP headers / UUI | — | **Do not survive the PSTN.** Confirmed: every Twilio header mechanism is SIP-only |

If the call center has a **SIP trunk** you can dial instead of its PSTN number, the
full X-header/UUI channel applies and this problem disappears.

### Within the middleware's own legs (internal plumbing)
- Query params on any webhook/`action`/`statusCallback` URL (signature-validated, fully supported)
- `<Parameter name="..." value="..."/>` on `<Connect><Stream>` (in the WS `start` message, <500 chars each) and `<Connect><ConversationRelay>` (in the `setup` message)
- Conference/queue friendly-names as carriers
- `ParentCallSid` links child legs automatically

## 4. The Retell fact that ties it together

From Retell's official docs: on inbound SIP calls, **Retell automatically extracts
`X-*` headers into `call.custom_sip_headers` and exposes them as dynamic variables**
(prefix stripped) — zero configuration. And its custom-telephony dial-in is
`sip:{call_id}@sip.retellai.com` after registering the call via API.

So the clean end-to-end, if every hop is SIP:

```
Webex ──SIP──► Twilio SIP Domain ──webhook──► middleware ──REST/TwiML──► sip:...@sip.retellai.com
       X-Correlation-Id          SipHeader_X-Correlation-Id        ?X-Correlation-Id=...
                                                                   └─► Retell: call.custom_sip_headers
```

One known Retell+Twilio gap (from Retell's docs): Twilio does **not** honor custom SIP
headers in REFER requests — so cold-transfer-with-headers from Retell through Twilio
drops the key; transfers need the middleware to re-dial with headers instead.

## Open questions for the Webex side (not Twilio's problem)

1. Can Webex Calling egress the call as direct SIP to an arbitrary SIP domain
   (Twilio's `*.sip.twilio.com`), and can it stamp a custom X-header or UUI per call?
2. If Webex can only do PSTN: can it make an out-of-band API call (POST the context)
   at transfer time? That plus caller-ID/DID matching is Twilio's recommended fallback.
