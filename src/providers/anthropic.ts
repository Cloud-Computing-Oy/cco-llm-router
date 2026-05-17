import { createAnthropic } from '@ai-sdk/anthropic';

const apiKey = process.env.ANTHROPIC_API_KEY;

export const anthropicAvailable = Boolean(apiKey);

const provider = apiKey ? createAnthropic({ apiKey }) : null;

export function anthropicModel(name: string) {
  if (!provider) throw new Error('ANTHROPIC_API_KEY not set');
  return provider(name);
}
