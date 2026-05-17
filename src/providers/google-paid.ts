import { createGoogleGenerativeAI } from '@ai-sdk/google';

// Separate from the regular google provider so the router can chain
// 'free key first, paid key on quota exhaustion'. Reads exclusively
// from GOOGLE_GENERATIVE_AI_API_KEY_PAID.
const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY_PAID;

export const googlePaidAvailable = Boolean(apiKey);

const provider = apiKey ? createGoogleGenerativeAI({ apiKey }) : null;

export function googlePaidModel(name: string) {
  if (!provider) throw new Error('GOOGLE_GENERATIVE_AI_API_KEY_PAID not set');
  return provider(name);
}
