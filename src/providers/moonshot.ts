import { createOpenAI } from '@ai-sdk/openai';

const envKey = process.env.MOONSHOT_API_KEY;
const BASE = process.env.MOONSHOT_BASE_URL ?? 'https://api.moonshot.ai/v1';

export const moonshotAvailable = Boolean(envKey);

const envProvider = envKey ? createOpenAI({ apiKey: envKey, baseURL: BASE }) : null;

export function moonshotModel(name: string, opts?: { apiKey?: string }) {
  if (opts?.apiKey) {
    return createOpenAI({ apiKey: opts.apiKey, baseURL: BASE })(name);
  }
  if (!envProvider) throw new Error('MOONSHOT_API_KEY not set');
  return envProvider(name);
}
