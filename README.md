## [Read the Twilio blog that goes with this repo: Enable Real Time Human-to-Human Voice Translation with Twilio ConversationRelay](https://www.twilio.com/en-us/blog/translation-with-conversationrelay) 

## Local ConversationRelay server

This repo also includes a local Node.js server for quick ConversationRelay testing with a public tunnel such as ngrok.

### 1. Configure environment

```bash
cp .env.example .env
```

Set at least:

```bash
PUBLIC_BASE_URL=https://your-ngrok-domain.ngrok-free.dev
TRANSLATION_PROVIDER=aws # or mock for no AWS Translate calls
AWS_REGION=us-east-1
```

For a two-party call where the server dials the agent/callee, also set:

```bash
AUTO_DIAL_AGENT=true
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_DEFAULT_FROM=+1yourTwilioNumber
AGENT_PHONE_NUMBER=+1agentPhoneNumber
```

### 2. Run the local server

```bash
npm install
npm run local
```

The server listens on `http://localhost:3000` and exposes:

- `POST /twiml/inbound` — Twilio voice webhook returning ConversationRelay TwiML
- `GET /health` — health check
- `GET /sessions` — in-memory connection/session debug view
- `WS /ws` — ConversationRelay websocket endpoint

### 3. Start a tunnel

```bash
ngrok http 3000
```

Use the HTTPS forwarding URL as `PUBLIC_BASE_URL`, for example:

```bash
PUBLIC_BASE_URL=https://seclusion-fester-corny.ngrok-free.dev
```

### 4. Configure Twilio

Set your Twilio phone number's Voice webhook to:

```text
https://seclusion-fester-corny.ngrok-free.dev/twiml/inbound
```

When Twilio calls that webhook, the returned TwiML points ConversationRelay at:

```text
wss://seclusion-fester-corny.ngrok-free.dev/ws
```
