import { createGoogleGenerativeAI } from '@ai-sdk/google';

const envKey =
  process.env.GOOGLE_GENERATIVE_AI_API_KEY ??
  process.env.GOOGLE_GENAI_API_KEY ??
  process.env.GEMINI_API_KEY;

export const googleAvailable = Boolean(envKey);

const envProvider = envKey ? createGoogleGenerativeAI({ apiKey: envKey }) : null;

export function googleModel(name: string, opts?: { apiKey?: string }) {
  if (opts?.apiKey) {
    return createGoogleGenerativeAI({ apiKey: opts.apiKey })(name);
  }
  if (!envProvider) throw new Error('GOOGLE_GENERATIVE_AI_API_KEY not set');
  return envProvider(name);
}
