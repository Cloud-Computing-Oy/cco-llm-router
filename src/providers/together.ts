import { createOpenAI } from '@ai-sdk/openai';

// Together.ai exposes an OpenAI-compatible API on a different base URL.
// Pricing is roughly 2× DeepInfra for the same Llama 3.3 70B, but with
// stricter SLA and a wider model catalog (including DeepSeek). Used as a
// secondary cheap fallback when DeepInfra is over budget or errors.
const apiKey = process.env.TOGETHER_API_KEY;

export const togetherAvailable = Boolean(apiKey);

const provider = apiKey
  ? createOpenAI({ apiKey, baseURL: 'https://api.together.xyz/v1' })
  : null;

export function togetherModel(name: string) {
  if (!provider) throw new Error('TOGETHER_API_KEY not set');
  return provider(name);
}
