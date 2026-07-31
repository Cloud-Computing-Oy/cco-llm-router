import { createOpenAI } from '@ai-sdk/openai';

const envKey = process.env.OPENROUTER_API_KEY;
const BASE = 'https://openrouter.ai/api/v1';

export const openrouterAvailable = Boolean(envKey);

const envProvider = envKey ? createOpenAI({ apiKey: envKey, baseURL: BASE }) : null;

export function openrouterModel(name: string, opts?: { apiKey?: string }) {
  if (opts?.apiKey) {
    return createOpenAI({ apiKey: opts.apiKey, baseURL: BASE })(name);
  }
  if (!envProvider) throw new Error('OPENROUTER_API_KEY not set');
  return envProvider(name);
}
