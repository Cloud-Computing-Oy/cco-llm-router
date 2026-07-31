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
  | 'together'
  | 'deepseek'
  | 'moonshot';

/**
 * `keyIndex` is meaningful only for the Google free provider: when the
 * env has multiple keys (`GOOGLE_GENERATIVE_AI_API_KEY` + `_2`/`_3`/…),
 * the router expands each `google:` spec into N copies with rising
 * `keyIndex`, so the fallback chain rotates through them on per-project
 * 429s before falling through to the next provider.
 */
export type Spec = { provider: Provider; model: string; keyIndex?: number };
