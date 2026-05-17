import { createOpenAI } from '@ai-sdk/openai';

// Groq exposes an OpenAI-compatible API on a different base URL.
const apiKey = process.env.GROQ_API_KEY;

export const groqAvailable = Boolean(apiKey);

const provider = apiKey
  ? createOpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1' })
  : null;

export function groqModel(name: string) {
  if (!provider) throw new Error('GROQ_API_KEY not set');
  return provider(name);
}
