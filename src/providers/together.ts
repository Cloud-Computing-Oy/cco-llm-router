import { createOpenAI } from '@ai-sdk/openai';

const envKey = process.env.TOGETHER_API_KEY;
const BASE = 'https://api.together.xyz/v1';

export const togetherAvailable = Boolean(envKey);

const envProvider = envKey ? createOpenAI({ apiKey: envKey, baseURL: BASE }) : null;

export function togetherModel(name: string, opts?: { apiKey?: string }) {
  if (opts?.apiKey) {
    return createOpenAI({ apiKey: opts.apiKey, baseURL: BASE })(name);
  }
  if (!envProvider) throw new Error('TOGETHER_API_KEY not set');
  return envProvider(name);
}
