import { createOpenAI } from '@ai-sdk/openai';

export function createOpenAICompatibleProvider(config: {
  envKey: string | undefined;
  envName: string;
  baseURL: string;
}) {
  const envProvider = config.envKey
    ? createOpenAI({ apiKey: config.envKey, baseURL: config.baseURL })
    : null;
  return {
    available: Boolean(config.envKey),
    model(name: string, opts?: { apiKey?: string }) {
      if (opts?.apiKey) {
        return createOpenAI({ apiKey: opts.apiKey, baseURL: config.baseURL }).chat(name);
      }
      if (!envProvider) throw new Error(`${config.envName} not set`);
      return envProvider.chat(name);
    },
  };
}
