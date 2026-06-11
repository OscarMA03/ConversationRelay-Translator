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
