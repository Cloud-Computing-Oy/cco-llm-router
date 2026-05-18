import { createOpenAI } from '@ai-sdk/openai';

const envKey = process.env.OPENAI_API_KEY;

export const openaiAvailable = Boolean(envKey);

const envProvider = envKey ? createOpenAI({ apiKey: envKey }) : null;

export function openaiModel(name: string, opts?: { apiKey?: string }) {
  if (opts?.apiKey) {
    return createOpenAI({ apiKey: opts.apiKey })(name);
  }
  if (!envProvider) throw new Error('OPENAI_API_KEY not set');
  return envProvider(name);
}
