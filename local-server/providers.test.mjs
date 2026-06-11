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
