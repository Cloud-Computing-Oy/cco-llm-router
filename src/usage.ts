/**
 * Per-provider, per-month usage tracker. Persists to a JSON file under
 * $XDG_STATE_HOME (or ~/.local/state). Concurrency model: best-effort —
 * we read-modify-write synchronously. The file is small (<10 KB) and
 * called once per LLM round-trip, so contention from a single host's
 * concurrent agents is not a real concern; cross-host runs would each
 * track locally, which is acceptable because budgets are dashboard-
 * enforced at the provider too.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { estimateCostUSD } from './pricing';
import type { Provider } from './types';

type ProviderUsage = {
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
  calls: number;
};

type MonthlyUsage = {
  /** YYYY-MM in UTC — month boundary triggers reset. */
  month: string;
  providers: Partial<Record<Provider, ProviderUsage>>;
  /** Tracks which budget-warning thresholds have already fired this month, per provider. */
  thresholds?: Partial<Record<Provider, number[]>>;
};

function stateDir(): string {
  const base = process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state');
  return join(base, 'cco-llm-router');
}

function statePath(): string {
  return join(stateDir(), 'usage.json');
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function emptyState(): MonthlyUsage {
  return { month: currentMonth(), providers: {}, thresholds: {} };
}

function loadState(): MonthlyUsage {
  const p = statePath();
  if (!existsSync(p)) return emptyState();
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as MonthlyUsage;
    if (raw.month !== currentMonth()) return emptyState();
    if (!raw.thresholds) raw.thresholds = {};
    return raw;
  } catch {
    return emptyState();
  }
}

function saveState(s: MonthlyUsage): void {
  try {
    mkdirSync(stateDir(), { recursive: true });
    writeFileSync(statePath(), JSON.stringify(s, null, 2));
  } catch (err) {
    // Don't let usage tracking break an inference call.
    console.warn(`[usage] failed to persist: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function recordUsage(
  provider: Provider,
  model: string,
  inputTokens: number,
  outputTokens: number,
): void {
  const cost = estimateCostUSD(provider, model, inputTokens, outputTokens);
  const s = loadState();
  const cur = s.providers[provider] ?? { inputTokens: 0, outputTokens: 0, costUSD: 0, calls: 0 };
  cur.inputTokens += inputTokens;
  cur.outputTokens += outputTokens;
  cur.costUSD += cost;
  cur.calls += 1;
  s.providers[provider] = cur;
  saveState(s);
}

export function getMonthlySpendUSD(provider: Provider): number {
  const s = loadState();
  return s.providers[provider]?.costUSD ?? 0;
}

export function getCurrentMonthSpend(): {
  month: string;
  totalUSD: number;
  perProvider: MonthlyUsage['providers'];
  thresholds: MonthlyUsage['thresholds'];
} {
  const s = loadState();
  const totalUSD = Object.values(s.providers).reduce((sum, u) => sum + (u?.costUSD ?? 0), 0);
  return { month: s.month, totalUSD, perProvider: s.providers, thresholds: s.thresholds };
}

export function markThresholdNotified(provider: Provider, threshold: number): void {
  const s = loadState();
  if (!s.thresholds) s.thresholds = {};
  const list = s.thresholds[provider] ?? [];
  if (!list.includes(threshold)) {
    list.push(threshold);
    s.thresholds[provider] = list;
    saveState(s);
  }
}

export function resetUsage(): void {
  saveState(emptyState());
}
