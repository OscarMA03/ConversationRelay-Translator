# Translation Provider Benchmark & Pluggable Backends — Design

**Date:** 2026-06-11
**Status:** Approved approach (Approach 1: shared provider module with plain `fetch`)

## Goal

Compare translation latency across AWS Translate, Azure Translator, Google Cloud
Translation, and DeepL to pick the fastest backend for the local
ConversationRelay translation server — and make the live server able to use
whichever provider wins.

## Decisions made during brainstorming

1. **Test method:** offline benchmark script (no phone call required, repeatable,
   apples-to-apples). Live-call shadow mode was considered and rejected for now.
2. **Providers:** add Azure Translator, Google Cloud Translation (v2 REST), and
   DeepL alongside the existing AWS Translate and `mock` providers.
3. **Server scope:** the live server's `TRANSLATION_PROVIDER` env var accepts any
   provider name, so the benchmark winner is immediately usable in real calls.
4. **No new dependencies:** Azure, Google, and DeepL are called via built-in
   `fetch` with key-based REST auth. AWS keeps the existing
   `@aws-sdk/client-translate` client. Official SDKs were rejected (dependency
   weight; SDK retry logic distorts latency measurements).

## Components

### 1. `local-server/providers.mjs` (new)

Single module exporting the provider registry.

Interface per provider:

```js
{
  name: 'azure',                       // registry key
  isConfigured() -> boolean,           // are required env vars present?
  translate(text, sourceLang, targetLang) -> Promise<string>
}
```

`getProvider(name)` returns the provider or throws on unknown name.
`listProviders()` returns all providers (benchmark uses this and filters on
`isConfigured()`).

Provider implementations:

| Provider | Endpoint | Auth |
|----------|----------|------|
| `aws`    | `@aws-sdk/client-translate` `TranslateTextCommand` (existing code, moved) | AWS credential chain / `AWS_PROFILE` |
| `azure`  | `POST https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=<src>&to=<tgt>` | `Ocp-Apim-Subscription-Key`, `Ocp-Apim-Subscription-Region` headers |
| `google` | `POST https://translation.googleapis.com/language/translate/v2` | `key=<API key>` query param |
| `deepl`  | `POST <DEEPL_API_URL>/v2/translate` (default `https://api-free.deepl.com`) | `Authorization: DeepL-Auth-Key <key>` header |
| `mock`   | returns `[<target>] <text>` locally | none |

Language-code notes: providers receive lowercase ISO codes (`en`, `es`) as the
server uses today; the DeepL implementation uppercases them (DeepL requires
`EN`, `ES`). Google v2 returns HTML-escaped text; decode entities (`&#39;` etc.)
before returning.

### 2. `local-server/server.mjs` (modified)

- `translateText()` delegates to `getProvider(process.env.TRANSLATION_PROVIDER ?? 'aws')`.
- Behavior preserved: skip translation when source === target or text is empty;
  on provider error, return original text unless
  `TRANSLATION_FALLBACK_ORIGINAL=false`, in which case rethrow.
- The inline AWS client and mock branch move into `providers.mjs`.
- No changes to websocket/TwiML/call-flow logic.

### 3. `local-server/benchmark.mjs` (new) + `npm run benchmark`

- Loads `.env` (dotenv), builds the configured-provider list (excluding `mock`
  unless `--include-mock` is passed); prints a notice naming skipped
  (unconfigured) providers.
- Test corpus: ~10 short conversational phrases mirroring the live call flow,
  half en→es and half es→en (phone-call register: greetings, questions,
  numbers, addresses).
- Protocol per provider: 1 untimed warmup request (connection/TLS setup), then
  3 timed rounds over the full corpus, sequential requests (no concurrency, to
  avoid throttling skew). Timing via `performance.now()` around the
  `translate()` call.
- Failures: a failed request records as a failure for that provider and the
  run continues.
- Output: a table per provider with `min / avg / p95 (ms)`, request count,
  failure count, and one sample translation (for an eyeball quality check).
  Providers sorted by avg latency. Exit code 0 even with provider failures;
  non-zero only if no provider is configured.

### 4. `.env.example` (modified)

New block:

```bash
# Azure Translator
AZURE_TRANSLATOR_KEY=
AZURE_TRANSLATOR_REGION=
# Google Cloud Translation (v2, API key)
GOOGLE_TRANSLATE_API_KEY=
# DeepL (free tier key; set DEEPL_API_URL=https://api.deepl.com for pro)
DEEPL_API_KEY=
DEEPL_API_URL=
```

`TRANSLATION_PROVIDER` comment updated to list `aws | azure | google | deepl | mock`.

## Error handling

- **Server path:** unchanged contract — translation errors log and fall back to
  original text (configurable via `TRANSLATION_FALLBACK_ORIGINAL`).
- **Benchmark path:** per-request failures are counted and shown; an
  unconfigured provider is skipped with a printed notice, not an error.
- **Unknown provider name:** `getProvider()` throws at startup (server) or
  argument-parse time (benchmark) with the list of valid names.

## Testing

- `TRANSLATION_PROVIDER=mock npm run local` + a live call still works (no
  regression in call flow).
- `npm run benchmark` with only AWS configured prints AWS results and skips the
  rest gracefully.
- Each new provider verified with a single curl-equivalent smoke call once its
  key is added.
- Direction check: benchmark output sample translations confirm en→es and
  es→en both translate correctly per provider.

## Out of scope

- Live-call shadow mode (rejected during brainstorming; can be added later on
  top of the same provider module).
- Translation *quality* scoring (samples are printed for manual eyeballing only).
- Google Cloud Translation v3 / service-account auth.
- Streaming translation.
