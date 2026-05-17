import { createOpenAI } from '@ai-sdk/openai';

const apiKey = process.env.OPENAI_API_KEY;

export const openaiAvailable = Boolean(apiKey);

const provider = apiKey ? createOpenAI({ apiKey }) : null;

export function openaiModel(name: string) {
  if (!provider) throw new Error('OPENAI_API_KEY not set');
  return provider(name);
}
