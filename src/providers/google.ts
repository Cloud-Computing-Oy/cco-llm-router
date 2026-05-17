import { createGoogleGenerativeAI } from '@ai-sdk/google';

// Free / metered Google Gemini key. Use 'google-paid' for the dedicated
// paid-tier key — keeping them as separate providers lets the router
// chain 'free key first, paid key on quota exhaustion'.
const apiKey =
  process.env.GOOGLE_GENERATIVE_AI_API_KEY ??
  process.env.GOOGLE_GENAI_API_KEY ??
  process.env.GEMINI_API_KEY;

export const googleAvailable = Boolean(apiKey);

const provider = apiKey ? createGoogleGenerativeAI({ apiKey }) : null;

export function googleModel(name: string) {
  if (!provider) throw new Error('GOOGLE_GENERATIVE_AI_API_KEY not set');
  return provider(name);
}
