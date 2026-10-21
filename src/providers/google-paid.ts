import { createGoogle } from '@ai-sdk/google';

const envKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY_PAID;

export const googlePaidAvailable = Boolean(envKey);

const envProvider = envKey ? createGoogle({ apiKey: envKey }) : null;

export function googlePaidModel(name: string, opts?: { apiKey?: string }) {
  if (opts?.apiKey) {
    return createGoogle({ apiKey: opts.apiKey })(name);
  }
  if (!envProvider) throw new Error('GOOGLE_GENERATIVE_AI_API_KEY_PAID not set');
  return envProvider(name);
}
