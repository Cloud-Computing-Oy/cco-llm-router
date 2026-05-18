/**
 * Shared types extracted to break circular dependencies:
 * router.ts ↔ budget.ts ↔ usage.ts ↔ pricing.ts ↔ fallback.ts
 *
 * `Provider` and `Spec` are the only types crossed by all five files,
 * so they live here and every module imports from this leaf file.
 */

export type Provider =
  | 'anthropic'
  | 'google'
  | 'google-paid'
  | 'openai'
  | 'groq'
  | 'openrouter'
  | 'ollama'
  | 'deepinfra'
  | 'together';

export type Spec = { provider: Provider; model: string };
