/**
 * Per-provider monthly budget enforcement. Reads CCO_LLM_BUDGET_<X>_USD
 * env vars (per provider) and compares against the local usage tracker.
 *
 * When local estimated spend on a provider exceeds 90% of its cap, the
 * router treats that provider as unavailable for *new* requests, which
 * cascades to the next candidate in the fallback chain. The actual hard
 * stop should be set in each provider's dashboard — this is a safety
 * net, not the primary control.
 *
 * Setting a budget to 0 (or omitting the env var) leaves the provider
 * unrestricted by the router. To explicitly disable a provider, unset
 * its API key instead.
 *
 * Env keys (USD):
 *   CCO_LLM_BUDGET_ANTHROPIC_USD
 *   CCO_LLM_BUDGET_OPENAI_USD
 *   CCO_LLM_BUDGET_GOOGLE_PAID_USD
 *   CCO_LLM_BUDGET_DEEPINFRA_USD
 *   CCO_LLM_BUDGET_TOGETHER_USD
 *   CCO_LLM_BUDGET_OPENROUTER_USD
 *   CCO_LLM_BUDGET_GROQ_USD
 */
import type { Provider } from './types';
import { getMonthlySpendUSD } from './usage';

const SAFETY_MARGIN = 0.9;

const ENV_KEY: Record<Provider, string> = {
  anthropic: 'CCO_LLM_BUDGET_ANTHROPIC_USD',
  google: 'CCO_LLM_BUDGET_GOOGLE_USD',
  'google-paid': 'CCO_LLM_BUDGET_GOOGLE_PAID_USD',
  openai: 'CCO_LLM_BUDGET_OPENAI_USD',
  groq: 'CCO_LLM_BUDGET_GROQ_USD',
  openrouter: 'CCO_LLM_BUDGET_OPENROUTER_USD',
  ollama: 'CCO_LLM_BUDGET_OLLAMA_USD',
  deepinfra: 'CCO_LLM_BUDGET_DEEPINFRA_USD',
  together: 'CCO_LLM_BUDGET_TOGETHER_USD',
};

export function getBudgetUSD(provider: Provider): number {
  const raw = process.env[ENV_KEY[provider]];
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function withinBudget(provider: Provider): boolean {
  const cap = getBudgetUSD(provider);
  if (cap === 0) return true;
  const spent = getMonthlySpendUSD(provider);
  return spent < cap * SAFETY_MARGIN;
}
