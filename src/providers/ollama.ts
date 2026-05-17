import { createOllama } from 'ai-sdk-ollama';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? '';

// Treated as available iff OLLAMA_BASE_URL is explicitly set so the
// router doesn't try to call a non-existent endpoint with a long socket
// timeout on every request.
export const ollamaAvailable = Boolean(OLLAMA_BASE_URL);

const provider = OLLAMA_BASE_URL ? createOllama({ baseURL: OLLAMA_BASE_URL }) : null;

export function ollamaModel(name: string) {
  if (!provider) throw new Error('OLLAMA_BASE_URL not set');
  return provider(name);
}
