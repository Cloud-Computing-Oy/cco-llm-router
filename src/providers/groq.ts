import { createOpenAI } from '@ai-sdk/openai';

const envKey = process.env.GROQ_API_KEY;
const BASE = 'https://api.groq.com/openai/v1';

export const groqAvailable = Boolean(envKey);

const envProvider = envKey ? createOpenAI({ apiKey: envKey, baseURL: BASE }) : null;

export function groqModel(name: string, opts?: { apiKey?: string }) {
  if (opts?.apiKey) {
    return createOpenAI({ apiKey: opts.apiKey, baseURL: BASE })(name);
  }
  if (!envProvider) throw new Error('GROQ_API_KEY not set');
  return envProvider(name);
}
