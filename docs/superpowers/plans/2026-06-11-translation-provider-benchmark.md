# Translation Provider Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pluggable translation providers (aws/azure/google/deepl/mock) for the local ConversationRelay server, plus an offline latency benchmark script to compare them.

**Architecture:** A new `local-server/providers.mjs` module owns all provider implementations behind a uniform `translate(text, sourceLang, targetLang)` interface; `server.mjs` and a new `local-server/benchmark.mjs` script both consume it. REST providers (Azure, Google, DeepL) use built-in `fetch`; AWS keeps the existing SDK client. Zero new npm dependencies.

**Tech Stack:** Node 25 ESM (`.mjs`), built-in `node:test` runner for tests, built-in `fetch`, `@aws-sdk/client-translate` (already installed), `dotenv` (already installed).

**Spec:** `docs/superpowers/specs/2026-06-11-translation-provider-benchmark-design.md`

## File Structure

- Create: `local-server/providers.mjs` — provider registry: `providers`, `getProvider()`, `listProviders()`, `translateText()` (the skip/fallback wrapper the server uses)
- Create: `local-server/providers.test.mjs` — unit tests (fetch stubbed; no network)
- Create: `local-server/stats.mjs` — `computeStats(samples)` → `{min, avg, p95}`
- Create: `local-server/stats.test.mjs`
- Create: `local-server/benchmark.mjs` — CLI benchmark script
- Modify: `local-server/server.mjs` — delete inline AWS client + `translateText()`, import from providers module
- Modify: `package.json` — add `test` and `benchmark` scripts
- Modify: `.env.example` — new provider credential vars

**Conventions used throughout:** tests set/unset `process.env` vars and stub `globalThis.fetch`, restoring both via `t.after()`. Run all tests with `npm test` (= `node --test local-server/`).

---

### Task 1: Provider registry skeleton (mock provider, getProvider, listProviders)

**Files:**
- Create: `local-server/providers.test.mjs`
- Create: `local-server/providers.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add the test script to package.json**

In `package.json`, change the `scripts` block to:

```json
  "scripts": {
    "local": "node local-server/server.mjs",
    "start": "node local-server/server.mjs",
    "test": "node --test",
    "benchmark": "node local-server/benchmark.mjs"
  },
```

- [ ] **Step 2: Write the failing tests**

Create `local-server/providers.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { getProvider, listProviders } from './providers.mjs';

// --- helpers used by later tasks too ---

export function stubFetch(t, impl) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  t.after(() => { globalThis.fetch = original; });
}

export function stubEnv(t, vars) {
  const saved = {};
  for (const [key, value] of Object.entries(vars)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

// --- registry ---

test('mock provider translates by prefixing the target language', async () => {
  const result = await getProvider('mock').translate('hello', 'en', 'es');
  assert.equal(result, '[es] hello');
});

test('mock provider is always configured', () => {
  assert.equal(getProvider('mock').isConfigured(), true);
});

test('getProvider throws on unknown provider and lists valid names', () => {
  assert.throws(() => getProvider('bing'), /Unknown translation provider "bing".*aws.*azure.*deepl.*google.*mock/s);
});

test('listProviders returns all five providers', () => {
  const names = listProviders().map((p) => p.name).sort();
  assert.deepEqual(names, ['aws', 'azure', 'deepl', 'google', 'mock']);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module ... providers.mjs`

- [ ] **Step 4: Write the minimal registry with mock + placeholder entries**

Create `local-server/providers.mjs`:

```js
import { TranslateClient, TranslateTextCommand } from '@aws-sdk/client-translate';

let awsClient;
function getAwsClient() {
  awsClient ??= new TranslateClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
  return awsClient;
}

export const providers = {
  aws: {
    name: 'aws',
    isConfigured: () => Boolean(process.env.AWS_PROFILE || process.env.AWS_ACCESS_KEY_ID),
    async translate(text, sourceLang, targetLang) {
      const response = await getAwsClient().send(new TranslateTextCommand({
        Text: text,
        SourceLanguageCode: sourceLang,
        TargetLanguageCode: targetLang
      }));
      return response.TranslatedText ?? text;
    }
  },
  azure: {
    name: 'azure',
    isConfigured: () => false,
    async translate() { throw new Error('not implemented'); }
  },
  deepl: {
    name: 'deepl',
    isConfigured: () => false,
    async translate() { throw new Error('not implemented'); }
  },
  google: {
    name: 'google',
    isConfigured: () => false,
    async translate() { throw new Error('not implemented'); }
  },
  mock: {
    name: 'mock',
    isConfigured: () => true,
    async translate(text, sourceLang, targetLang) {
      return `[${targetLang}] ${text}`;
    }
  }
};

export function getProvider(name) {
  const provider = providers[name];
  if (!provider) {
    throw new Error(
      `Unknown translation provider "${name}". Valid providers: ${Object.keys(providers).sort().join(', ')}`
    );
  }
  return provider;
}

export function listProviders() {
  return Object.values(providers);
}
```

(The AWS provider is included now because it is a straight move of existing
`server.mjs` logic, not new behavior; the azure/deepl/google placeholders are
replaced in Tasks 2–4.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add package.json local-server/providers.mjs local-server/providers.test.mjs
git commit -m "feat: add translation provider registry with mock and aws providers"
```

---

### Task 2: DeepL provider

**Files:**
- Modify: `local-server/providers.test.mjs`
- Modify: `local-server/providers.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `local-server/providers.test.mjs`:

```js
// --- deepl ---

test('deepl is configured only when DEEPL_API_KEY is set', (t) => {
  stubEnv(t, { DEEPL_API_KEY: undefined });
  assert.equal(getProvider('deepl').isConfigured(), false);
  process.env.DEEPL_API_KEY = 'k'; // restored by the stubEnv cleanup above
  assert.equal(getProvider('deepl').isConfigured(), true);
});

test('deepl posts uppercased language codes with auth header to the free endpoint by default', async (t) => {
  stubEnv(t, { DEEPL_API_KEY: 'test-key', DEEPL_API_URL: undefined });
  let captured;
  stubFetch(t, async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({ translations: [{ text: 'Hola' }] }), { status: 200 });
  });

  const result = await getProvider('deepl').translate('Hello', 'en', 'es');

  assert.equal(result, 'Hola');
  assert.equal(captured.url, 'https://api-free.deepl.com/v2/translate');
  assert.equal(captured.options.headers.Authorization, 'DeepL-Auth-Key test-key');
  const body = JSON.parse(captured.options.body);
  assert.deepEqual(body, { text: ['Hello'], source_lang: 'EN', target_lang: 'ES' });
});

test('deepl honors DEEPL_API_URL override', async (t) => {
  stubEnv(t, { DEEPL_API_KEY: 'test-key', DEEPL_API_URL: 'https://api.deepl.com' });
  let captured;
  stubFetch(t, async (url) => {
    captured = url;
    return new Response(JSON.stringify({ translations: [{ text: 'Hola' }] }), { status: 200 });
  });
  await getProvider('deepl').translate('Hello', 'en', 'es');
  assert.equal(captured, 'https://api.deepl.com/v2/translate');
});

test('deepl throws on non-ok response', async (t) => {
  stubEnv(t, { DEEPL_API_KEY: 'test-key', DEEPL_API_URL: undefined });
  stubFetch(t, async () => new Response('Quota exceeded', { status: 456 }));
  await assert.rejects(
    () => getProvider('deepl').translate('Hello', 'en', 'es'),
    /DeepL failed \(456\)/
  );
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm test`
Expected: FAIL — deepl tests reject with "not implemented" / isConfigured false

- [ ] **Step 3: Implement the deepl provider**

In `local-server/providers.mjs`, replace the `deepl` placeholder entry with:

```js
  deepl: {
    name: 'deepl',
    isConfigured: () => Boolean(process.env.DEEPL_API_KEY),
    async translate(text, sourceLang, targetLang) {
      const baseUrl = (process.env.DEEPL_API_URL || 'https://api-free.deepl.com').replace(/\/$/, '');
      const response = await fetch(`${baseUrl}/v2/translate`, {
        method: 'POST',
        headers: {
          Authorization: `DeepL-Auth-Key ${process.env.DEEPL_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: [text],
          source_lang: sourceLang.toUpperCase(),
          target_lang: targetLang.toUpperCase()
        })
      });
      if (!response.ok) {
        throw new Error(`DeepL failed (${response.status}): ${await response.text()}`);
      }
      const json = await response.json();
      return json.translations?.[0]?.text ?? text;
    }
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add local-server/providers.mjs local-server/providers.test.mjs
git commit -m "feat: add DeepL translation provider"
```

---

### Task 3: Azure Translator provider

**Files:**
- Modify: `local-server/providers.test.mjs`
- Modify: `local-server/providers.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `local-server/providers.test.mjs`:

```js
// --- azure ---

test('azure is configured only when key and region are set', (t) => {
  stubEnv(t, { AZURE_TRANSLATOR_KEY: 'k', AZURE_TRANSLATOR_REGION: undefined });
  assert.equal(getProvider('azure').isConfigured(), false);
  process.env.AZURE_TRANSLATOR_REGION = 'eastus'; // restored by the stubEnv cleanup above
  assert.equal(getProvider('azure').isConfigured(), true);
});

test('azure posts to the translate endpoint with subscription headers', async (t) => {
  stubEnv(t, { AZURE_TRANSLATOR_KEY: 'test-key', AZURE_TRANSLATOR_REGION: 'eastus' });
  let captured;
  stubFetch(t, async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify([{ translations: [{ text: 'Hola' }] }]), { status: 200 });
  });

  const result = await getProvider('azure').translate('Hello', 'en', 'es');

  assert.equal(result, 'Hola');
  assert.equal(
    captured.url,
    'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=en&to=es'
  );
  assert.equal(captured.options.headers['Ocp-Apim-Subscription-Key'], 'test-key');
  assert.equal(captured.options.headers['Ocp-Apim-Subscription-Region'], 'eastus');
  assert.deepEqual(JSON.parse(captured.options.body), [{ Text: 'Hello' }]);
});

test('azure throws on non-ok response', async (t) => {
  stubEnv(t, { AZURE_TRANSLATOR_KEY: 'test-key', AZURE_TRANSLATOR_REGION: 'eastus' });
  stubFetch(t, async () => new Response('bad key', { status: 401 }));
  await assert.rejects(
    () => getProvider('azure').translate('Hello', 'en', 'es'),
    /Azure Translator failed \(401\)/
  );
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm test`
Expected: FAIL — azure tests reject with "not implemented" / isConfigured false

- [ ] **Step 3: Implement the azure provider**

In `local-server/providers.mjs`, replace the `azure` placeholder entry with:

```js
  azure: {
    name: 'azure',
    isConfigured: () => Boolean(process.env.AZURE_TRANSLATOR_KEY && process.env.AZURE_TRANSLATOR_REGION),
    async translate(text, sourceLang, targetLang) {
      const url = 'https://api.cognitive.microsofttranslator.com/translate'
        + `?api-version=3.0&from=${encodeURIComponent(sourceLang)}&to=${encodeURIComponent(targetLang)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': process.env.AZURE_TRANSLATOR_KEY,
          'Ocp-Apim-Subscription-Region': process.env.AZURE_TRANSLATOR_REGION,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify([{ Text: text }])
      });
      if (!response.ok) {
        throw new Error(`Azure Translator failed (${response.status}): ${await response.text()}`);
      }
      const json = await response.json();
      return json[0]?.translations?.[0]?.text ?? text;
    }
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add local-server/providers.mjs local-server/providers.test.mjs
git commit -m "feat: add Azure Translator provider"
```

---

### Task 4: Google Cloud Translation provider (with HTML entity decoding)

**Files:**
- Modify: `local-server/providers.test.mjs`
- Modify: `local-server/providers.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `local-server/providers.test.mjs`:

```js
// --- google ---

test('google is configured only when GOOGLE_TRANSLATE_API_KEY is set', (t) => {
  stubEnv(t, { GOOGLE_TRANSLATE_API_KEY: undefined });
  assert.equal(getProvider('google').isConfigured(), false);
  process.env.GOOGLE_TRANSLATE_API_KEY = 'k'; // restored by the stubEnv cleanup above
  assert.equal(getProvider('google').isConfigured(), true);
});

test('google posts to the v2 endpoint with the API key', async (t) => {
  stubEnv(t, { GOOGLE_TRANSLATE_API_KEY: 'test-key' });
  let captured;
  stubFetch(t, async (url, options) => {
    captured = { url, options };
    return new Response(
      JSON.stringify({ data: { translations: [{ translatedText: 'Hola' }] } }),
      { status: 200 }
    );
  });

  const result = await getProvider('google').translate('Hello', 'en', 'es');

  assert.equal(result, 'Hola');
  assert.equal(captured.url, 'https://translation.googleapis.com/language/translate/v2?key=test-key');
  assert.deepEqual(JSON.parse(captured.options.body), {
    q: 'Hello',
    source: 'en',
    target: 'es',
    format: 'text'
  });
});

test('google decodes HTML entities in the response', async (t) => {
  stubEnv(t, { GOOGLE_TRANSLATE_API_KEY: 'test-key' });
  stubFetch(t, async () => new Response(
    JSON.stringify({ data: { translations: [{ translatedText: 'I can&#39;t &amp; won&#39;t' }] } }),
    { status: 200 }
  ));
  const result = await getProvider('google').translate('hola', 'es', 'en');
  assert.equal(result, "I can't & won't");
});

test('google throws on non-ok response', async (t) => {
  stubEnv(t, { GOOGLE_TRANSLATE_API_KEY: 'test-key' });
  stubFetch(t, async () => new Response('forbidden', { status: 403 }));
  await assert.rejects(
    () => getProvider('google').translate('Hello', 'en', 'es'),
    /Google Translate failed \(403\)/
  );
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm test`
Expected: FAIL — google tests reject with "not implemented" / isConfigured false

- [ ] **Step 3: Implement the google provider**

In `local-server/providers.mjs`, add this helper above `export const providers`:

```js
function decodeHtmlEntities(text) {
  return text
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}
```

(`&amp;` is decoded last so `&amp;lt;` does not double-decode.)

Replace the `google` placeholder entry with:

```js
  google: {
    name: 'google',
    isConfigured: () => Boolean(process.env.GOOGLE_TRANSLATE_API_KEY),
    async translate(text, sourceLang, targetLang) {
      const url = 'https://translation.googleapis.com/language/translate/v2'
        + `?key=${encodeURIComponent(process.env.GOOGLE_TRANSLATE_API_KEY)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: text, source: sourceLang, target: targetLang, format: 'text' })
      });
      if (!response.ok) {
        throw new Error(`Google Translate failed (${response.status}): ${await response.text()}`);
      }
      const json = await response.json();
      const translated = json.data?.translations?.[0]?.translatedText;
      return translated ? decodeHtmlEntities(translated) : text;
    }
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (15 tests)

- [ ] **Step 5: Commit**

```bash
git add local-server/providers.mjs local-server/providers.test.mjs
git commit -m "feat: add Google Cloud Translation provider"
```

---

### Task 5: `translateText()` wrapper (skip + fallback logic)

**Files:**
- Modify: `local-server/providers.test.mjs`
- Modify: `local-server/providers.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `local-server/providers.test.mjs` (add `translateText` to the import at the top of the file: `import { getProvider, listProviders, translateText } from './providers.mjs';`):

```js
// --- translateText wrapper ---

test('translateText returns original when languages match', async (t) => {
  stubEnv(t, { TRANSLATION_PROVIDER: 'mock' });
  assert.equal(await translateText('hello', 'en', 'en'), 'hello');
});

test('translateText returns empty input unchanged', async (t) => {
  stubEnv(t, { TRANSLATION_PROVIDER: 'mock' });
  assert.equal(await translateText('', 'en', 'es'), '');
});

test('translateText uses the provider named by TRANSLATION_PROVIDER', async (t) => {
  stubEnv(t, { TRANSLATION_PROVIDER: 'mock' });
  assert.equal(await translateText('hello', 'en', 'es'), '[es] hello');
});

test('translateText falls back to original text on provider error by default', async (t) => {
  stubEnv(t, {
    TRANSLATION_PROVIDER: 'deepl',
    DEEPL_API_KEY: 'test-key',
    DEEPL_API_URL: undefined,
    TRANSLATION_FALLBACK_ORIGINAL: undefined
  });
  stubFetch(t, async () => new Response('down', { status: 503 }));
  assert.equal(await translateText('hello', 'en', 'es'), 'hello');
});

test('translateText rethrows when TRANSLATION_FALLBACK_ORIGINAL=false', async (t) => {
  stubEnv(t, {
    TRANSLATION_PROVIDER: 'deepl',
    DEEPL_API_KEY: 'test-key',
    DEEPL_API_URL: undefined,
    TRANSLATION_FALLBACK_ORIGINAL: 'false'
  });
  stubFetch(t, async () => new Response('down', { status: 503 }));
  await assert.rejects(() => translateText('hello', 'en', 'es'), /DeepL failed \(503\)/);
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm test`
Expected: FAIL — `translateText` is not exported

- [ ] **Step 3: Implement the wrapper**

Append to `local-server/providers.mjs`:

```js
export async function translateText(text, sourceLang, targetLang) {
  if (!text || sourceLang === targetLang) return text;

  const provider = getProvider(process.env.TRANSLATION_PROVIDER ?? 'aws');
  try {
    return await provider.translate(text, sourceLang, targetLang);
  } catch (error) {
    console.log(new Date().toISOString(), 'Translate failed:', error?.message ?? error);
    if (process.env.TRANSLATION_FALLBACK_ORIGINAL !== 'false') return text;
    throw error;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (20 tests)

- [ ] **Step 5: Commit**

```bash
git add local-server/providers.mjs local-server/providers.test.mjs
git commit -m "feat: add translateText wrapper with same-language skip and error fallback"
```

---

### Task 6: Refactor server.mjs to use the provider module

**Files:**
- Modify: `local-server/server.mjs`

- [ ] **Step 1: Replace the AWS import with the provider module import**

In `local-server/server.mjs`, delete line 6:

```js
import { TranslateClient, TranslateTextCommand } from '@aws-sdk/client-translate';
```

and add in its place:

```js
import { translateText } from './providers.mjs';
```

- [ ] **Step 2: Delete the inline client and translateText function**

Delete line 10:

```js
const translateClient = new TranslateClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
```

Delete the whole `translateText` function (lines 195–214 in the original file — from `async function translateText(text, sourceLanguageCode, targetLanguageCode) {` through its closing `}`). The mock branch and AWS call now live in `providers.mjs`; behavior is identical. The call site in `handlePrompt` (`await translateText(text, party.sourceLanguageCode, party.targetLanguageCode)`) is unchanged.

- [ ] **Step 3: Verify the full test suite still passes**

Run: `npm test`
Expected: PASS (20 tests)

- [ ] **Step 4: Smoke-test the server with the mock provider**

Run:

```bash
TRANSLATION_PROVIDER=mock node local-server/server.mjs &
sleep 1
curl -s http://localhost:3000/health
curl -s http://localhost:3000/sessions
kill %1
```

Expected: `ok` from `/health` and a JSON object with empty `connections`/`transcript` from `/sessions`; startup log line `Local ConversationRelay server listening on http://localhost:3000`.

- [ ] **Step 5: Commit**

```bash
git add local-server/server.mjs
git commit -m "refactor: server uses pluggable translation providers"
```

---

### Task 7: Latency stats helper

**Files:**
- Create: `local-server/stats.test.mjs`
- Create: `local-server/stats.mjs`

- [ ] **Step 1: Write the failing tests**

Create `local-server/stats.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStats } from './stats.mjs';

test('computeStats returns null for no samples', () => {
  assert.equal(computeStats([]), null);
});

test('computeStats of a single sample is that sample', () => {
  assert.deepEqual(computeStats([42]), { min: 42, avg: 42, p95: 42 });
});

test('computeStats computes min, avg, and p95 over unsorted samples', () => {
  // 20 samples: 1..20 shuffled. p95 = 19th of 20 sorted values.
  const samples = [12, 3, 20, 7, 1, 16, 9, 14, 5, 18, 2, 11, 8, 19, 4, 15, 10, 6, 17, 13];
  const stats = computeStats(samples);
  assert.equal(stats.min, 1);
  assert.equal(stats.avg, 10.5);
  assert.equal(stats.p95, 19);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module ... stats.mjs`

- [ ] **Step 3: Implement computeStats**

Create `local-server/stats.mjs`:

```js
export function computeStats(samples) {
  if (samples.length === 0) return null;

  const sorted = [...samples].sort((a, b) => a - b);
  const min = sorted[0];
  const avg = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
  return { min, avg, p95 };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (23 tests)

- [ ] **Step 5: Commit**

```bash
git add local-server/stats.mjs local-server/stats.test.mjs
git commit -m "feat: add latency stats helper (min/avg/p95)"
```

---

### Task 8: Benchmark script

**Files:**
- Create: `local-server/benchmark.mjs`

(No unit test — the computation lives in already-tested modules; the script is
verified end-to-end with the mock provider in Step 2, which needs no network.)

- [ ] **Step 1: Write the benchmark script**

Create `local-server/benchmark.mjs`:

```js
import 'dotenv/config';

import { performance } from 'node:perf_hooks';
import { listProviders } from './providers.mjs';
import { computeStats } from './stats.mjs';

// Conversational, phone-call-register phrases — half en→es, half es→en,
// mirroring the live two-party call flow.
const PHRASES = [
  { text: 'Hello, thank you for calling. How can I help you today?', source: 'en', target: 'es' },
  { text: 'Can you confirm the address for the appointment?', source: 'en', target: 'es' },
  { text: 'The technician will arrive between nine and eleven in the morning.', source: 'en', target: 'es' },
  { text: 'Is there anything else I can help you with?', source: 'en', target: 'es' },
  { text: 'Please hold for one moment while I check that for you.', source: 'en', target: 'es' },
  { text: 'Hola, llamo porque tengo un problema con mi pedido.', source: 'es', target: 'en' },
  { text: 'Mi número de teléfono es seis uno nueve, cinco cinco cinco, doce treinta y cuatro.', source: 'es', target: 'en' },
  { text: '¿Cuánto tiempo tarda en llegar el reembolso?', source: 'es', target: 'en' },
  { text: 'La dirección es calle Juárez ciento veinte, colonia Centro.', source: 'es', target: 'en' },
  { text: 'Muchas gracias por su ayuda, que tenga buen día.', source: 'es', target: 'en' }
];

const ROUNDS = 3;
const includeMock = process.argv.includes('--include-mock');

const candidates = listProviders().filter((p) => includeMock || p.name !== 'mock');
const configured = candidates.filter((p) => p.isConfigured());
const skipped = candidates.filter((p) => !p.isConfigured());

for (const provider of skipped) {
  console.log(`Skipping ${provider.name}: missing credentials (see .env.example).`);
}
if (configured.length === 0) {
  console.error('No translation providers configured. Add provider keys to .env (see .env.example).');
  process.exit(1);
}

const results = [];
for (const provider of configured) {
  process.stdout.write(`Benchmarking ${provider.name} `);
  const samples = [];
  let failures = 0;
  let sample = null;

  // One untimed warmup request so connection/TLS setup doesn't pollute round 1.
  try {
    await provider.translate(PHRASES[0].text, PHRASES[0].source, PHRASES[0].target);
  } catch {
    // A failing warmup is fine — real rounds below will record the failures.
  }

  for (let round = 0; round < ROUNDS; round++) {
    for (const phrase of PHRASES) {
      const start = performance.now();
      try {
        const translated = await provider.translate(phrase.text, phrase.source, phrase.target);
        samples.push(performance.now() - start);
        sample ??= { original: phrase.text, translated };
        process.stdout.write('.');
      } catch {
        failures += 1;
        process.stdout.write('x');
      }
    }
  }
  process.stdout.write('\n');

  results.push({
    name: provider.name,
    stats: computeStats(samples),
    requests: samples.length + failures,
    failures,
    sample
  });
}

results.sort((a, b) => (a.stats?.avg ?? Infinity) - (b.stats?.avg ?? Infinity));

const ms = (value) => (value === undefined ? '-' : String(Math.round(value)));
console.log('');
console.log('Provider     Min (ms)   Avg (ms)   P95 (ms)   Requests   Failures');
console.log('-'.repeat(68));
for (const result of results) {
  console.log(
    result.name.padEnd(12)
    + ms(result.stats?.min).padStart(9) + '  '
    + ms(result.stats?.avg).padStart(9) + '  '
    + ms(result.stats?.p95).padStart(9) + '  '
    + String(result.requests).padStart(9) + '  '
    + String(result.failures).padStart(9)
  );
}

console.log('\nSample translations:');
for (const result of results) {
  if (result.sample) {
    console.log(`\n[${result.name}]`);
    console.log(`  "${result.sample.original}"`);
    console.log(`  → "${result.sample.translated}"`);
  }
}
```

- [ ] **Step 2: Verify end-to-end with the mock provider (no network needed)**

Run: `npm run benchmark -- --include-mock`
Expected output shape (mock is configured; aws/azure/google/deepl skipped on a machine without keys):

```
Skipping aws: missing credentials (see .env.example).
Skipping azure: missing credentials (see .env.example).
Skipping deepl: missing credentials (see .env.example).
Skipping google: missing credentials (see .env.example).
Benchmarking mock ..............................

Provider     Min (ms)   Avg (ms)   P95 (ms)   Requests   Failures
--------------------------------------------------------------------
mock                0          0          0         30          0

Sample translations:

[mock]
  "Hello, thank you for calling. How can I help you today?"
  → "[es] Hello, thank you for calling. How can I help you today?"
```

(Skips depend on which keys exist in `.env` when run; `mock` must show 30
requests, 0 failures.)

- [ ] **Step 3: Verify the no-providers error path**

Run: `npm run benchmark` (without `--include-mock`, on a machine with no provider keys)
Expected: prints the four skip lines, then `No translation providers configured...` and exits with code 1 (`echo $?` → 1). If real keys exist in `.env`, this check doesn't apply — skip it.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS (23 tests)

- [ ] **Step 5: Commit**

```bash
git add local-server/benchmark.mjs
git commit -m "feat: add translation provider latency benchmark script"
```

---

### Task 9: Environment documentation

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Update .env.example**

In `.env.example`, replace the line:

```bash
# Translation provider: aws or mock
```

with:

```bash
# Translation provider: aws | azure | google | deepl | mock
```

and append after the `TRANSLATION_FALLBACK_ORIGINAL=true` line:

```bash

# Azure Translator (both required for the azure provider)
AZURE_TRANSLATOR_KEY=
AZURE_TRANSLATOR_REGION=

# Google Cloud Translation v2 (API key)
GOOGLE_TRANSLATE_API_KEY=

# DeepL (free-tier key works; set DEEPL_API_URL=https://api.deepl.com for pro accounts)
DEEPL_API_KEY=
DEEPL_API_URL=
```

- [ ] **Step 2: Document the benchmark in README.md**

Append to `README.md`:

```markdown

## Translation provider benchmark

The local server supports multiple translation backends, selected via
`TRANSLATION_PROVIDER` in `.env`: `aws`, `azure`, `google`, `deepl`, or `mock`.

To compare their latency, add whichever provider keys you have to `.env`
(see `.env.example`) and run:

```bash
npm run benchmark
```

Each configured provider gets one untimed warmup request, then 3 rounds of 10
conversational phrases (en→es and es→en). The report shows min/avg/p95 latency,
failure counts, and a sample translation per provider, sorted by average
latency. Providers without credentials are skipped. Add `--include-mock` to
include the no-op mock provider as a baseline.
```

- [ ] **Step 3: Commit**

```bash
git add .env.example README.md
git commit -m "docs: document translation providers and benchmark"
```

---

### Task 10: Final verification

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS — 23 tests, 0 failures

- [ ] **Step 2: Server still serves TwiML**

Run:

```bash
TRANSLATION_PROVIDER=mock node local-server/server.mjs &
sleep 1
curl -s -X POST http://localhost:3000/twiml/inbound -d 'From=%2B15550001111&To=%2B15550002222'
kill %1
```

Expected: XML response containing `<ConversationRelay url="wss://` and `<Parameter name="whichParty" value="caller" />`.

- [ ] **Step 3: Benchmark runs clean with mock**

Run: `npm run benchmark -- --include-mock`
Expected: mock row shows 30 requests / 0 failures.

- [ ] **Step 4: Verify nothing uncommitted remains**

Run: `git status`
Expected: clean working tree.
