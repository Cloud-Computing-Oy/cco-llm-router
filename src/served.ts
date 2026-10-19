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

export type ServedStore = { current?: ServedCandidate };

const storage = new AsyncLocalStorage<ServedStore>();

export function getServedCandidate(): ServedCandidate | undefined {
  return storage.getStore()?.current;
}

function writeLog(candidate: ServedCandidate): void {
  const logPath = process.env.CCO_LLM_SERVED_LOG;
  if (!logPath) return;
  try {
    appendFileSync(logPath, `${JSON.stringify(candidate)}\n`, { encoding: "utf8" });
  } catch {
    // Telemetry must never break inference.
  }
}

export function recordServedCandidate(candidate: ServedCandidate): void {
  recordServedCandidateTo(storage.getStore(), candidate);
}

/** Write to a store captured before a ReadableStream was returned; ALS does
 *  not propagate into later `pull` callbacks. */
export function recordServedCandidateTo(
  store: ServedStore | undefined,
  candidate: ServedCandidate,
): void {
  if (store) store.current = candidate;
  writeLog(candidate);
}

export function currentServedStore(): ServedStore | undefined {
  return storage.getStore();
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
    try {
      const result = await fn();
      return { result, served: storage.getStore()?.current };
    } catch (error) {
      // Preserve the error type but attach the last attempt for diagnostics.
      if (error && typeof error === "object") {
        (error as { servedCandidate?: ServedCandidate }).servedCandidate =
          storage.getStore()?.current;
      }
      throw error;
    }
  });
}

/** Stable, low-cardinality error class for telemetry. */
export type ErrorClass =
  | "abort"
  | "rate_limit"
  | "quota"
  | "timeout"
  | "network"
  | "unavailable"
  | "provider_error";

export function errorClassOf(error: unknown): ErrorClass {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (name === "AbortError" || /\babort/i.test(message)) return "abort";
  if (/rate.?limit|\b429\b|tokens per minute/i.test(message)) return "rate_limit";
  if (/quota|insufficient|\b402\b|payment required/i.test(message)) return "quota";
  if (/timeout|etimedout|timed out/i.test(message)) return "timeout";
  if (/econnrefused|econnreset|socket hang up|fetch failed/i.test(message)) return "network";
  if (/service unavailable|\b503\b|overloaded|ollama request exceeded/i.test(message)) {
    return "unavailable";
  }
  return "provider_error";
}

export function isRetryableClass(kind: ErrorClass): boolean {
  return (
    kind === "rate_limit" ||
    kind === "quota" ||
    kind === "timeout" ||
    kind === "network" ||
    kind === "unavailable"
  );
}
