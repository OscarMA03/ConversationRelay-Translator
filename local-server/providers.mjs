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
