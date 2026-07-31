import { createGoogleGenerativeAI } from '@ai-sdk/google';

const envKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY_PAID;

export const googlePaidAvailable = Boolean(envKey);

const envProvider = envKey ? createGoogleGenerativeAI({ apiKey: envKey }) : null;

export function googlePaidModel(name: string, opts?: { apiKey?: string }) {
  if (opts?.apiKey) {
    return createGoogleGenerativeAI({ apiKey: opts.apiKey })(name);
  }
  if (!envProvider) throw new Error('GOOGLE_GENERATIVE_AI_API_KEY_PAID not set');
  return envProvider(name);
}
