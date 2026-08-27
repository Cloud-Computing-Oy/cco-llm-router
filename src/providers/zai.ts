import { createOpenAICompatibleProvider } from './openai-compatible';

const provider = createOpenAICompatibleProvider({
  envKey: process.env.ZAI_API_KEY,
  envName: 'ZAI_API_KEY',
  baseURL: process.env.ZAI_BASE_URL ?? 'https://api.z.ai/api/paas/v4',
});

export const zaiAvailable = provider.available;
export const zaiModel = provider.model;
