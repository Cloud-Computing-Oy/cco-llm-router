import { createOpenAI } from '@ai-sdk/openai';

const envKey = process.env.DEEPINFRA_API_KEY;
const BASE = 'https://api.deepinfra.com/v1/openai';

export const deepinfraAvailable = Boolean(envKey);

const envProvider = envKey ? createOpenAI({ apiKey: envKey, baseURL: BASE }) : null;

export function deepinfraModel(name: string, opts?: { apiKey?: string }) {
  if (opts?.apiKey) {
    return createOpenAI({ apiKey: opts.apiKey, baseURL: BASE })(name);
  }
  if (!envProvider) throw new Error('DEEPINFRA_API_KEY not set');
  return envProvider(name);
}
