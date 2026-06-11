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
