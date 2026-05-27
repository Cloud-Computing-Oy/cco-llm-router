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
 *   CCO_LLM_BUDGET_DEEPSEEK_USD
 *   CCO_LLM_BUDGET_OPENROUTER_USD
 *   CCO_LLM_BUDGET_GROQ_USD
 *
 * Threshold warnings: when local spend crosses 50% / 75% / 90% / 100% of
 * a provider's cap, a single warning is logged (via console.warn or
 * onBudgetWarning callback if set). State is tracked in usage.json so
 * the same threshold doesn't fire on every request.
 */
import type { Provider } from './types';
import { getMonthlySpendUSD, getCurrentMonthSpend, markThresholdNotified } from './usage';

const SAFETY_MARGIN = 0.9;
const THRESHOLDS = [0.5, 0.75, 0.9, 1.0] as const;

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
  deepseek: 'CCO_LLM_BUDGET_DEEPSEEK_USD',
};

export type BudgetWarning = {
  provider: Provider;
  threshold: number;       // 0.5 / 0.75 / 0.9 / 1.0
  spentUSD: number;
  budgetUSD: number;
  percent: number;         // actual percentage at warning time
};

type WarningHandler = (w: BudgetWarning) => void;

let warningHandler: WarningHandler | null = null;

export function onBudgetWarning(handler: WarningHandler | null): void {
  warningHandler = handler;
}

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

/**
 * Called after each successful recordUsage to check whether the new spend
 * has crossed a warning threshold. Emits a one-shot warning per threshold
 * per month. Safe to call unconditionally; no-op when no budget is set.
 */
export function checkThresholds(provider: Provider): void {
  const cap = getBudgetUSD(provider);
  if (cap === 0) return;

  const spent = getMonthlySpendUSD(provider);
  const percent = spent / cap;
  const state = getCurrentMonthSpend();
  const notified = state.thresholds?.[provider] ?? [];

  for (const t of THRESHOLDS) {
    if (percent >= t && !notified.includes(t)) {
      const warning: BudgetWarning = {
        provider,
        threshold: t,
        spentUSD: Number(spent.toFixed(4)),
        budgetUSD: cap,
        percent: Number((percent * 100).toFixed(1)),
      };
      markThresholdNotified(provider, t);
      if (warningHandler) {
        try {
          warningHandler(warning);
        } catch (err) {
          // Don't let handler errors break the call path.
          console.warn(`[budget] warning handler threw: ${err instanceof Error ? err.message : err}`);
        }
      } else {
        console.warn(
          `[cco-llm-router] budget ${Math.round(t * 100)}% threshold reached: ${provider} spent $${warning.spentUSD} / $${cap} (${warning.percent}%)`,
        );
      }
    }
  }
}
