import { createOpenAI } from '@ai-sdk/openai';

// DeepInfra exposes an OpenAI-compatible API on a different base URL.
// Currently the cheapest path to Llama 3.3 70B class ($0.23 in / $0.40 out
// per 1M tokens, May 2026) — used as the ultra-cheap paid fallback after
// all free providers have been exhausted.
const apiKey = process.env.DEEPINFRA_API_KEY;

export const deepinfraAvailable = Boolean(apiKey);

const provider = apiKey
  ? createOpenAI({ apiKey, baseURL: 'https://api.deepinfra.com/v1/openai' })
  : null;

export function deepinfraModel(name: string) {
  if (!provider) throw new Error('DEEPINFRA_API_KEY not set');
  return provider(name);
}
