export {
  createRouter,
  resolveModel,
  listAliases,
  DEFAULT_ALIASES,
  type Provider,
  type Spec,
  type Router,
  type RouterOptions,
  type ResolveOptions,
  type PerCallKeys,
} from './router';
export {
  selectAutomaticAlias,
  type AutomaticRoutingInput,
  type TaskKind,
  type TaskRisk,
} from './automatic-routing';
export {
  chat,
  chatJson,
  chatJsonStrict,
  extractJson,
  DEFAULT_CALL_TIMEOUT_MS,
  type ChatRequest,
} from './helpers';
export {
  truncateForLlm,
  truncateForLlmWithWarning,
  DEFAULT_MAX_PROMPT_CHARS,
} from './truncate';
export { createFallbackModel } from './fallback';
export {
  createAnthropicGateway,
  createClaudeChildEnvironment,
  listenAnthropicGateway,
  toModelMessages,
  type AnthropicMessagesRequest,
  type GatewayConfig,
  type GatewayGenerate,
} from './anthropic-gateway';

// Cost & budget surface — exposed so callers can build dashboards,
// pre-flight checks, or alerting on top of the same data the router uses.
export {
  recordUsage,
  getMonthlySpendUSD,
  getCurrentMonthSpend,
  resetUsage,
} from './usage';
export { getBudgetUSD, withinBudget, onBudgetWarning, type BudgetWarning } from './budget';
export { PRICING, priceOf, estimateCostUSD, type Price } from './pricing';

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
export { deepinfraAvailable, deepinfraModel } from './providers/deepinfra';
export { togetherAvailable, togetherModel } from './providers/together';
export { deepseekAvailable, deepseekModel } from './providers/deepseek';
export { moonshotAvailable, moonshotModel } from './providers/moonshot';
export { dashscopeAvailable, dashscopeModel } from './providers/dashscope';
export { zaiAvailable, zaiModel } from './providers/zai';
export { minimaxAvailable, minimaxModel } from './providers/minimax';
export { mistralAvailable, mistralModel } from './providers/mistral';
export { nvidiaAvailable, nvidiaModel } from './providers/nvidia';
export {
  MODEL_CATALOG,
  listCatalog,
  hasReviewedAutomaticPricing,
  requiresUnknownPricingApproval,
  type CatalogEntry,
  type LicenseClass,
  type ModelCapabilities,
  type ModelFamily,
} from './catalog';
