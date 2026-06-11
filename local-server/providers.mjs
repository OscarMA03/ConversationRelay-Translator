import { TranslateClient, TranslateTextCommand } from '@aws-sdk/client-translate';

function getAwsClient() {
  return new TranslateClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
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
