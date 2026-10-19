import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync } from "node:fs";

/**
 * Per-call served-candidate telemetry (WP2a, D4).
 *
 * `createFallbackModel` writes the candidate on every attempt. Code running
 * inside `withServedCandidate` (the AI SDK call and any tool callbacks) can
 * read the current value with `getServedCandidate()`. The wrapper also returns
 * the final value, which is what a caller needs after the call has resolved:
 *
 *   const { result, served } = await withServedCandidate(() => generateText(...));
 *
 * `CCO_LLM_SERVED_LOG` optionally appends one JSON line per attempt. A missing
 * candidate is `unknown`, never a success claim.
 *
 * Callers must pass `maxRetries: 0` to generateText/generateObject so every
 * provider-SDK retry is a separate attempt and a separate budget reservation.
 */
export type ServedCandidate = {
  candidateId: string;
  chainIndex: number;
  provider: string;
  model: string;
  attempt: number;
  served: boolean;
  usage?: { inputTokens: number; outputTokens: number };
  errorClass?: string;
};

type Store = { current?: ServedCandidate };

const storage = new AsyncLocalStorage<Store>();

export function getServedCandidate(): ServedCandidate | undefined {
  return storage.getStore()?.current;
}

export function recordServedCandidate(candidate: ServedCandidate): void {
  const store = storage.getStore();
  if (store) store.current = candidate;
  const logPath = process.env.CCO_LLM_SERVED_LOG;
  if (!logPath) return;
  try {
    appendFileSync(logPath, `${JSON.stringify(candidate)}\n`, { encoding: "utf8" });
  } catch {
    // Telemetry must never break inference.
  }
}

/** Run `fn` in the current store, or create one when no caller wrapped the call. */
export function runWithServedCandidate<T>(fn: () => PromiseLike<T>): Promise<T> {
  const run = () => Promise.resolve(fn());
  return storage.getStore() ? run() : storage.run({}, run);
}

export async function withServedCandidate<T>(
  fn: () => PromiseLike<T>,
): Promise<{ result: T; served?: ServedCandidate }> {
  return storage.run({}, async () => {
    const result = await fn();
    return { result, served: storage.getStore()?.current };
  });
}

/** Stable, low-cardinality error class for telemetry. */
export function errorClassOf(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (name === "AbortError" || /abort/i.test(message)) return "abort";
  if (/rate.?limit|429|tokens per minute/i.test(message)) return "rate_limit";
  if (/quota|insufficient|402|payment required/i.test(message)) return "quota";
  if (/timeout|etimedout|timed out/i.test(message)) return "timeout";
  if (/econnrefused|econnreset|socket hang up|fetch failed/i.test(message)) return "network";
  if (/service unavailable|503|overloaded/i.test(message)) return "unavailable";
  return "provider_error";
}
