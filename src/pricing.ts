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
import { getLiveDataset } from './model-data';

export type Price = {
  inputPerM: number;
  outputPerM: number;
  /**
   * Peak-hour rates, when the provider charges more at defined times.
   * The top-level fields are then the off-peak rates, and priceOf() keeps
   * returning them: only effectivePrice()/estimateCostUSD() are time-aware.
   */
  peak?: { inputPerM: number; outputPerM: number };
};

const Z: Price = { inputPerM: 0, outputPerM: 0 };

/**
 * Provider peak windows in UTC, weekdays only. Half-open [start, end) in
 * whole hours. DeepSeek charges double during peak; off-peak is the list
 * price. Source: DeepSeek pricing docs, effective 2026-09-10.
 */
const PEAK_WINDOWS_UTC: Partial<Record<Provider, ReadonlyArray<readonly [number, number]>>> = {
  deepseek: [
    [1, 4],
    [6, 10],
  ],
};

function isPeakHour(provider: Provider, at: Date): boolean {
  const windows = PEAK_WINDOWS_UTC[provider];
  if (!windows) return false;
  const day = at.getUTCDay(); // 0 = Sunday
  if (day === 0 || day === 6) return false;
  const hour = at.getUTCHours();
  return windows.some(([start, end]) => hour >= start && hour < end);
}

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

  // --- deepseek (native api.deepseek.com) ---
  // V4.1 Flash list price (2026-09-10): $0.15 / $0.6 off-peak, $0.3 / $1.2
  // peak. Priced at cache-MISS input: the usage tracker has no cache-hit
  // accounting, so this over-estimates spend (safe for the budget net).
  // All three ids are served by V4.1 Flash — the legacy `deepseek-v4-flash`
  // redirects, and `deepseek-v4-pro` starts redirecting 2026-09-14.
  'deepseek:deepseek-flash': { inputPerM: 0.15, outputPerM: 0.6, peak: { inputPerM: 0.3, outputPerM: 1.2 } },
  'deepseek:deepseek-v4-flash': { inputPerM: 0.15, outputPerM: 0.6, peak: { inputPerM: 0.3, outputPerM: 1.2 } },
  'deepseek:deepseek-v4-pro': { inputPerM: 0.15, outputPerM: 0.6, peak: { inputPerM: 0.3, outputPerM: 1.2 } },

  // --- moonshot (Kimi Platform; cache-miss input for conservative budgets) ---
  'moonshot:kimi-k3': { inputPerM: 3, outputPerM: 15 },

  // --- Z.ai (permanent list price; do not encode temporary discounts) ---
  'zai:glm-5.3-flash': { inputPerM: 0.15, outputPerM: 0.5 },
  'zai:glm-5.3': { inputPerM: 1.4, outputPerM: 4.4 },
};

export function priceOf(provider: Provider, model: string): Price {
  const live = getLiveDataset().models.find((m) => m.provider === provider && m.model === model);
  if (live?.pricing) {
    // Return the dataset object whole: rebuilding it field-by-field silently
    // dropped `peak` and made the live snapshot outrank the peak-aware table.
    return live.pricing;
  }
  const k = `${provider}:${model}` as keyof typeof PRICING;
  return PRICING[k] ?? Z;
}

/**
 * Rates actually in effect at `at` (default: now). Strips the `peak` field so
 * callers get plain rates; falls back to the list price outside peak windows
 * and for providers without peak pricing.
 */
export function effectivePrice(provider: Provider, model: string, at: Date = new Date()): Price {
  const base = priceOf(provider, model);
  const rates = base.peak && isPeakHour(provider, at) ? base.peak : base;
  return { inputPerM: rates.inputPerM, outputPerM: rates.outputPerM };
}

export function estimateCostUSD(
  provider: Provider,
  model: string,
  inputTokens: number,
  outputTokens: number,
  at: Date = new Date(),
): number {
  const p = effectivePrice(provider, model, at);
  return (inputTokens / 1_000_000) * p.inputPerM + (outputTokens / 1_000_000) * p.outputPerM;
}
