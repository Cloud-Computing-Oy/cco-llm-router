import { createGoogleGenerativeAI } from '@ai-sdk/google';

// Prefer paid key; fall through to free; then GEMINI_API_KEY for older configs.
const apiKey =
  process.env.GOOGLE_GENERATIVE_AI_API_KEY_PAID ??
  process.env.GOOGLE_GENERATIVE_AI_API_KEY ??
  process.env.GOOGLE_GENAI_API_KEY ??
  process.env.GEMINI_API_KEY;

export const googleAvailable = Boolean(apiKey);

const provider = apiKey ? createGoogleGenerativeAI({ apiKey }) : null;

export function googleModel(name: string) {
  if (!provider) throw new Error('No Google API key in env');
  return provider(name);
}
