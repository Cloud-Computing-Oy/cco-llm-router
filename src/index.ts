export {
  createRouter,
  resolveModel,
  listAliases,
  DEFAULT_ALIASES,
  type Provider,
  type Spec,
  type Router,
  type RouterOptions,
} from './router.js';
export { createFallbackModel } from './fallback.js';

// Provider availability flags + raw constructors, for the rare service
// that wants to wire a provider directly (e.g. embeddings, which are not
// routed through resolveModel).
export { anthropicAvailable, anthropicModel } from './providers/anthropic.js';
export { googleAvailable, googleModel } from './providers/google.js';
export { openaiAvailable, openaiModel } from './providers/openai.js';
export { groqAvailable, groqModel } from './providers/groq.js';
export { openrouterAvailable, openrouterModel } from './providers/openrouter.js';
export { ollamaAvailable, ollamaModel } from './providers/ollama.js';
