import { createOpenAICompatibleProvider } from './openai-compatible';

const provider = createOpenAICompatibleProvider({
  envKey: process.env.MISTRAL_API_KEY,
  envName: 'MISTRAL_API_KEY',
  baseURL: process.env.MISTRAL_BASE_URL ?? 'https://api.mistral.ai/v1',
});

export const mistralAvailable = provider.available;
export const mistralModel = provider.model;
