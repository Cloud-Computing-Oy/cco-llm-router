import { createAnthropic } from '@ai-sdk/anthropic';

const envKey = process.env.ANTHROPIC_API_KEY;

export const anthropicAvailable = Boolean(envKey);

const envProvider = envKey ? createAnthropic({ apiKey: envKey }) : null;

export function anthropicModel(name: string, opts?: { apiKey?: string }) {
  if (opts?.apiKey) {
    return createAnthropic({ apiKey: opts.apiKey })(name);
  }
  if (!envProvider) throw new Error('ANTHROPIC_API_KEY not set');
  return envProvider(name);
}
