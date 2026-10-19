import { AsyncLocalStorage } from "node:async_hooks";
import type { ServedCandidate } from "./served";

/**
 * Budget hook surface for managed calls (WP2b). The router calls reserve()
 * before every provider candidate and settle() with the observed usage and
 * served candidate. A hook error is fail-closed: the provider is not called
 * without a successful reservation, and a failed settlement is surfaced.
 *
 * The caller installs hooks and a per-task context:
 *
 *   setBudgetHooks({ reserve, settle });
 *   await withBudgetContext({ taskId, phase: "artifact" }, () =>
 *     withServedCandidate(() => generateText({ model, maxRetries: 0 })),
 *   );
 */

export type BudgetPhase = "plan" | "artifact" | "review" | "learning" | "audit";

export type BudgetContext = { taskId: string; phase: BudgetPhase };

export type ReserveHookInput = {
  taskId: string;
  phase: BudgetPhase;
  candidateId: string;
  provider: string;
  model: string;
  maxInputTokens: number;
  maxOutputTokens: number;
};

export type SettleHookInput = {
  reservationId: string;
  usage: { inputTokens: number; outputTokens: number } | null;
  served: ServedCandidate | null;
};

export type BudgetHooks = {
  reserve(input: ReserveHookInput): Promise<{ reservationId: string; upperBoundUsd: number }>;
  settle(input: SettleHookInput): Promise<void>;
};

let hooks: BudgetHooks | undefined;
const context = new AsyncLocalStorage<BudgetContext>();

export function setBudgetHooks(next: BudgetHooks | undefined): void {
  hooks = next;
}

export function getBudgetHooks(): BudgetHooks | undefined {
  return hooks;
}

export function getBudgetContext(): BudgetContext | undefined {
  return context.getStore();
}

export function withBudgetContext<T>(
  budgetContext: BudgetContext,
  fn: () => PromiseLike<T>,
): Promise<T> {
  return context.run(budgetContext, async () => fn());
}
