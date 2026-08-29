import { createOpenAI } from '@ai-sdk/openai';

const envKey = process.env.DEEPSEEK_API_KEY;
const BASE = 'https://api.deepseek.com';

export const deepseekAvailable = Boolean(envKey);

const envProvider = envKey ? createOpenAI({ apiKey: envKey, baseURL: BASE }) : null;

export function deepseekModel(name: string, opts?: { apiKey?: string }) {
  if (opts?.apiKey) {
    return createOpenAI({ apiKey: opts.apiKey, baseURL: BASE }).chat(name);
  }
  if (!envProvider) throw new Error('DEEPSEEK_API_KEY not set');
  return envProvider.chat(name);
}
