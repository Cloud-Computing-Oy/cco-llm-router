import { createOpenAI } from '@ai-sdk/openai';

// OpenRouter is OpenAI-API-compatible at a different base URL.
const apiKey = process.env.OPENROUTER_API_KEY;

export const openrouterAvailable = Boolean(apiKey);

const provider = apiKey
  ? createOpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1' })
  : null;

export function openrouterModel(name: string) {
  if (!provider) throw new Error('OPENROUTER_API_KEY not set');
  return provider(name);
}
