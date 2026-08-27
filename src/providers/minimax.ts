import { createOpenAICompatibleProvider } from './openai-compatible';

const provider = createOpenAICompatibleProvider({
  envKey: process.env.MINIMAX_API_KEY,
  envName: 'MINIMAX_API_KEY',
  baseURL: process.env.MINIMAX_BASE_URL ?? 'https://api.minimax.io/v1',
});

export const minimaxAvailable = provider.available;
export const minimaxModel = provider.model;
