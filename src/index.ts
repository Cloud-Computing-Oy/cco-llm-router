export {
  createRouter,
  resolveModel,
  listAliases,
  DEFAULT_ALIASES,
  type Provider,
  type Spec,
  type Router,
  type RouterOptions,
} from './router';
export { chat, chatJson, type ChatRequest } from './helpers';
export { createFallbackModel } from './fallback';

// Provider availability flags + raw constructors, for the rare service
// that wants to wire a provider directly (e.g. embeddings, which are not
// routed through resolveModel).
export { anthropicAvailable, anthropicModel } from './providers/anthropic';
export { googleAvailable, googleModel } from './providers/google';
export { googlePaidAvailable, googlePaidModel } from './providers/google-paid';
export { openaiAvailable, openaiModel } from './providers/openai';
export { groqAvailable, groqModel } from './providers/groq';
export { openrouterAvailable, openrouterModel } from './providers/openrouter';
export { ollamaAvailable, ollamaModel } from './providers/ollama';
