/**
 * Per-model pricing table in USD per 1M tokens (input / output).
 * Reference: provider pricing pages, updated August 2026.
 *
 * The table is intentionally incomplete — only models we actually route
 * to are listed. An unlisted model is priced as ZERO (it is either
 * free-tier, local, or an OpenRouter ":free" model). Callers that route
 * to a paid model not in this table should add it here.
 *
 * Used by usage.ts to convert (inputTokens, outputTokens) → USD spent,
 * which feeds the per-provider monthly budget enforced in budget.ts.
 */
import type { Provider } from './types';

export type Price = { inputPerM: number; outputPerM: number };

const Z: Price = { inputPerM: 0, outputPerM: 0 };

export const PRICING: Record<string, Price> = {
  // --- anthropic ---
  'anthropic:claude-sonnet-4-6': { inputPerM: 3, outputPerM: 15 },
  'anthropic:claude-haiku-4-5-20251001': { inputPerM: 1, outputPerM: 5 },
  'anthropic:claude-opus-4-7': { inputPerM: 15, outputPerM: 75 },

  // --- google (free tier — billed at $0 until 429) ---
  'google:gemini-2.5-flash': Z,
  'google:gemini-2.5-pro': Z,

  // --- google-paid ---
  'google-paid:gemini-2.5-flash': { inputPerM: 0.075, outputPerM: 0.3 },
  'google-paid:gemini-2.5-pro': { inputPerM: 1.25, outputPerM: 5 },

  // --- openai ---
  'openai:gpt-5': { inputPerM: 3, outputPerM: 15 },
  'openai:gpt-5-mini': { inputPerM: 0.25, outputPerM: 2 },
  'openai:gpt-5-nano': { inputPerM: 0.05, outputPerM: 0.4 },

  // --- groq (free tier — billed at $0 until rate-limited) ---
  'groq:qwen/qwen3.6-27b': Z,

  // --- openrouter (":free" models are zero; non-free OpenRouter is rare) ---

  // --- ollama (local) ---
  // All ollama models: zero cost, GPU electricity is out of scope.

  // --- deepinfra (paid only, no free tier) ---
  'deepinfra:meta-llama/Meta-Llama-3.1-8B-Instruct': { inputPerM: 0.04, outputPerM: 0.04 },
  'deepinfra:meta-llama/Meta-Llama-3.3-70B-Instruct': { inputPerM: 0.23, outputPerM: 0.4 },
  'deepinfra:meta-llama/Meta-Llama-3.3-70B-Instruct-Turbo': { inputPerM: 0.13, outputPerM: 0.39 },
  'deepinfra:Qwen/Qwen2.5-72B-Instruct': { inputPerM: 0.27, outputPerM: 0.4 },
  'deepinfra:deepseek-ai/DeepSeek-V3': { inputPerM: 0.49, outputPerM: 0.89 },

  // --- together (paid only) ---
  'together:meta-llama/Llama-3.3-70B-Instruct-Turbo': { inputPerM: 0.88, outputPerM: 0.88 },
  'together:meta-llama/Llama-3.3-70B-Instruct-Lite': { inputPerM: 0.54, outputPerM: 0.88 },
  'together:Qwen/Qwen2.5-72B-Instruct-Turbo': { inputPerM: 1.2, outputPerM: 1.2 },
  'together:deepseek-ai/DeepSeek-V3': { inputPerM: 1.25, outputPerM: 1.25 },

  // --- deepseek (native api.deepseek.com, V4) ---
  // Priced at cache-MISS input: the usage tracker has no cache-hit
  // accounting, so this over-estimates spend (safe for the budget net).
  // v4-pro reflects the 75%-off promo through 2026-05-31 — revisit after.
  'deepseek:deepseek-v4-flash': { inputPerM: 0.14, outputPerM: 0.28 },
  'deepseek:deepseek-v4-pro': { inputPerM: 0.435, outputPerM: 0.87 },

  // --- moonshot (Kimi Platform; cache-miss input for conservative budgets) ---
  'moonshot:kimi-k3': { inputPerM: 3, outputPerM: 15 },

  // --- Z.ai (permanent list price; do not encode temporary discounts) ---
  'zai:glm-5.3-flash': { inputPerM: 0.15, outputPerM: 0.5 },
  'zai:glm-5.3': { inputPerM: 1.4, outputPerM: 4.4 },
};

export function priceOf(provider: Provider, model: string): Price {
  return PRICING[`${provider}:${model}`] ?? Z;
}

export function estimateCostUSD(
  provider: Provider,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = priceOf(provider, model);
  return (inputTokens / 1_000_000) * p.inputPerM + (outputTokens / 1_000_000) * p.outputPerM;
}
