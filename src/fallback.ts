import type { LanguageModelV3, LanguageModelV3Usage } from '@ai-sdk/provider';
import type { LanguageModel } from 'ai';
import type { Provider } from './types';
import { recordUsage } from './usage';
import { checkThresholds } from './budget';
import { acquireOllamaLease } from './ollama-gate';
import {
  BudgetReservationError,
  getBudgetContext,
  getBudgetHooks,
} from './budget-hooks';
import {
  currentServedStore,
  errorClassOf,
  isRetryableClass,
  recordServedCandidate,
  recordServedCandidateTo,
  runWithServedCandidate,
} from './served';

type Inner = {
  label: string;
  provider: Provider;
  modelId: string;
  model: LanguageModel;
};

function isTransient(err: unknown): boolean {
  return isRetryableClass(errorClassOf(err));
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

const RETRY_DELAY_MS = 8_000;

/** Test seam: the retry delay is otherwise 8 s and makes pass-2 untestable. */
function retryDelayMs(): number {
  const raw = Number(process.env.CCO_LLM_FALLBACK_RETRY_DELAY_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : RETRY_DELAY_MS;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function usageOf(usage: LanguageModelV3Usage | undefined): { inputTokens: number; outputTokens: number } | undefined {
  if (!usage) return undefined;
  const input = usage.inputTokens?.total;
  const output = usage.outputTokens?.total;
  // A usage object with no totals is unknown, not a zero-token call.
  if (input === undefined && output === undefined) return undefined;
  return { inputTokens: input ?? 0, outputTokens: output ?? 0 };
}

function candidateId(c: Inner, chainIndex: number, attempt: number): string {
  return `${c.provider}:${c.modelId}#${chainIndex}#${attempt}`;
}

function servedRecord(
  c: Inner,
  chainIndex: number,
  attempt: number,
  served: boolean,
  usage?: { inputTokens: number; outputTokens: number },
  errorClass?: string,
) {
  return {
    candidateId: candidateId(c, chainIndex, attempt),
    chainIndex,
    provider: c.provider,
    model: c.modelId,
    attempt,
    served,
    ...(usage ? { usage } : {}),
    ...(errorClass ? { errorClass } : {}),
  };
}

function recordFailure(c: Inner, chainIndex: number, attempt: number, err: unknown): void {
  recordServedCandidate(servedRecord(c, chainIndex, attempt, false, undefined, errorClassOf(err)));
}

/** Conservative input bound: UTF-16 chars / 2 plus room for tool schemas. */
function estimateMaxInputTokens(options: unknown): number {
  try {
    return Math.ceil(JSON.stringify(options).length / 2) + 512;
  } catch {
    return 100_000;
  }
}

async function reserveFor(
  c: Inner,
  chainIndex: number,
  attempt: number,
  options: unknown,
): Promise<string | undefined> {
  const hooks = getBudgetHooks();
  if (!hooks) return undefined;
  const context = getBudgetContext();
  if (!context) throw new BudgetReservationError('budget context puuttuu managed callilta');
  const maxOutputTokens =
    (options as { maxOutputTokens?: number }).maxOutputTokens ?? 4096;
  try {
    const result = await hooks.reserve({
      taskId: context.taskId,
      phase: context.phase,
      candidateId: candidateId(c, chainIndex, attempt),
      provider: c.provider,
      model: c.modelId,
      maxInputTokens: estimateMaxInputTokens(options),
      maxOutputTokens,
    });
    return result.reservationId;
  } catch (error) {
    throw new BudgetReservationError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function settleFor(
  reservationId: string | undefined,
  usage: { inputTokens: number; outputTokens: number } | null,
  served: ReturnType<typeof servedRecord>,
): Promise<void> {
  if (!reservationId) return;
  const hooks = getBudgetHooks();
  if (!hooks) return;
  await hooks.settle({ reservationId, usage, served });
}

function tryRecord(c: Inner, usage: LanguageModelV3Usage | undefined): void {
  if (!usage) return;
  const inT = usage.inputTokens?.total ?? 0;
  const outT = usage.outputTokens?.total ?? 0;
  if (inT === 0 && outT === 0) return;
  try {
    recordUsage(c.provider, c.modelId, inT, outT);
    checkThresholds(c.provider);
  } catch {
    // Usage tracking must never break inference.
  }
}

type GenerateResult = Awaited<ReturnType<LanguageModelV3['doGenerate']>>;
type StreamResult = Awaited<ReturnType<LanguageModelV3['doStream']>>;

async function attemptGenerate(
  candidates: Inner[],
  options: Parameters<LanguageModelV3['doGenerate']>[0],
  attemptOffset = 1,
): Promise<{ value?: GenerateResult; lastErr?: unknown; allTransient: boolean }> {
  let lastErr: unknown;
  let allTransient = true;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const attempt = attemptOffset + i;
    let ollamaLease: Awaited<ReturnType<typeof acquireOllamaLease>> | undefined;
    let reservationId: string | undefined;
    let result: GenerateResult;
    try {
      reservationId = await reserveFor(c, i, attempt, options);
      if (c.provider === 'ollama') ollamaLease = await acquireOllamaLease(c.modelId);
      const operation = () => (c.model as LanguageModelV3).doGenerate(options);
      result = ollamaLease ? await ollamaLease.run(operation) : await operation();
    } catch (err) {
      // A reservation failure aborts the chain before any provider call.
      if (err instanceof BudgetReservationError) throw err;
      if (options.abortSignal?.aborted || isAbort(err)) {
        recordFailure(c, i, attempt, err);
        await settleFor(
          reservationId,
          null,
          servedRecord(c, i, attempt, false, undefined, errorClassOf(err)),
        );
        throw err;
      }
      recordFailure(c, i, attempt, err);
      await settleFor(
        reservationId,
        null,
        servedRecord(c, i, attempt, false, undefined, errorClassOf(err)),
      );
      lastErr = err;
      allTransient &&= isTransient(err);
      const reason = err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120);
      if (i === candidates.length - 1) {
        console.warn(`[fallback] ${c.label} failed (terminal): ${reason}`);
        return { lastErr: err, allTransient };
      }
      console.warn(`[fallback] ${c.label} failed: ${reason} — trying next`);
      continue;
    } finally {
      ollamaLease?.release();
    }
    // Success path is outside the provider catch: a settle failure must not be
    // recorded as a provider failure or settle the same reservation twice.
    const served = servedRecord(c, i, attempt, true, usageOf(result.usage));
    recordServedCandidate(served);
    tryRecord(c, result.usage);
    await settleFor(reservationId, served.usage ?? null, served);
    return { value: result, allTransient: false };
  }
  return { lastErr, allTransient };
}

async function attemptStream(
  candidates: Inner[],
  options: Parameters<LanguageModelV3['doStream']>[0],
  attemptOffset = 1,
): Promise<{ value?: StreamResult; lastErr?: unknown; allTransient: boolean }> {
  let lastErr: unknown;
  let allTransient = true;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const attempt = attemptOffset + i;
    let ollamaLease: Awaited<ReturnType<typeof acquireOllamaLease>> | undefined;
    let releaseWithStream = false;
    let reservationId: string | undefined;
    let result: StreamResult;
    try {
      reservationId = await reserveFor(c, i, attempt, options);
      if (c.provider === 'ollama') ollamaLease = await acquireOllamaLease(c.modelId);
      const operation = () => (c.model as LanguageModelV3).doStream(options);
      result = ollamaLease ? await ollamaLease.run(operation) : await operation();
      // The stream tap owns the lease from here; releasing in `finally` while
      // the tap is still consuming would defeat MAX_CONCURRENT.
      releaseWithStream = Boolean(ollamaLease);
    } catch (err) {
      if (err instanceof BudgetReservationError) throw err;
      if (options.abortSignal?.aborted || isAbort(err)) {
        recordFailure(c, i, attempt, err);
        await settleFor(
          reservationId,
          null,
          servedRecord(c, i, attempt, false, undefined, errorClassOf(err)),
        );
        throw err;
      }
      recordFailure(c, i, attempt, err);
      await settleFor(
        reservationId,
        null,
        servedRecord(c, i, attempt, false, undefined, errorClassOf(err)),
      );
      lastErr = err;
      allTransient &&= isTransient(err);
      const reason = err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120);
      if (i === candidates.length - 1) {
        console.warn(`[fallback] ${c.label} failed (terminal): ${reason}`);
        return { lastErr: err, allTransient };
      }
      console.warn(`[fallback] ${c.label} failed: ${reason} — trying next`);
      continue;
    } finally {
      if (!releaseWithStream) ollamaLease?.release();
    }
    // Do not claim served before the stream finishes; the tap records the
    // final outcome.
    const store = currentServedStore();
    const tapped = tapStreamForUsage(
      result.stream,
      c,
      i,
      attempt,
      store,
      reservationId,
      ollamaLease?.release,
    );
    releaseWithStream = Boolean(ollamaLease);
    return { value: { ...result, stream: tapped }, allTransient: false };
  }
  return { lastErr, allTransient };
}

function tapStreamForUsage(
  stream: StreamResult['stream'],
  c: Inner,
  chainIndex: number,
  attempt: number,
  store: ReturnType<typeof currentServedStore>,
  reservationId: string | undefined,
  onDone?: () => void,
): StreamResult['stream'] {
  let done = false;
  let recorded = false;
  let settled = false;
  const finish = () => {
    if (done) return;
    done = true;
    onDone?.();
  };
  const settleOnce = async (
    usage: { inputTokens: number; outputTokens: number } | null,
    served: ReturnType<typeof servedRecord>,
  ): Promise<void> => {
    if (settled) return;
    settled = true;
    recordServedCandidateTo(store, served);
    await settleFor(reservationId, usage, served);
  };
  const reader = stream.getReader();
  return new ReadableStream({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          // A stream that ends without a finish part is unknown, not a success.
          await settleOnce(
            null,
            servedRecord(c, chainIndex, attempt, false, undefined, 'provider_error'),
          );
          finish();
          controller.close();
          return;
        }
        const part = result.value as { type?: string; usage?: LanguageModelV3Usage; error?: unknown };
        if (part?.type === 'error') {
          // Provider streaming failures often arrive in-band, not as a
          // rejected read(); record the failed attempt before forwarding.
          if (!recorded) {
            recorded = true;
            const served = servedRecord(
              c,
              chainIndex,
              attempt,
              false,
              undefined,
              errorClassOf(part.error),
            );
            await settleOnce(null, served);
          }
        }
        if (part?.type === 'finish' && part.usage) {
          recorded = true;
          const served = servedRecord(c, chainIndex, attempt, true, usageOf(part.usage));
          await settleOnce(served.usage ?? null, served);
          tryRecord(c, part.usage);
        }
        controller.enqueue(result.value);
      } catch (error) {
        if (!recorded) {
          recorded = true;
          try {
            await settleOnce(
              null,
              servedRecord(c, chainIndex, attempt, false, undefined, errorClassOf(error)),
            );
          } catch (settleError) {
            finish();
            controller.error(settleError);
            return;
          }
        }
        finish();
        controller.error(error);
      }
    },
    async cancel(reason) {
      // A consumer may cancel after the finish part was recorded; settleOnce
      // keeps the successful record and does not overwrite it with an abort.
      try {
        if (!recorded) {
          recorded = true;
          await settleOnce(
            null,
            servedRecord(c, chainIndex, attempt, false, undefined, 'abort'),
          );
        }
      } finally {
        // Release the provider lease even when settlement rejects; the
        // rejection still reaches the caller from cancel().
        finish();
      }
      await reader.cancel(reason);
    },
  });
}

export function createFallbackModel(candidates: Inner[]): LanguageModelV3 {
  if (candidates.length === 0) throw new Error('createFallbackModel: empty candidate list');

  const first = candidates[0].model as LanguageModelV3;

  return {
    specificationVersion: 'v3',
    get provider() {
      return 'fallback';
    },
    get modelId() {
      return candidates.map((c) => c.label).join('|');
    },
    get supportedUrls() {
      return first.supportedUrls;
    },
    async doGenerate(options) {
      return runWithServedCandidate(async () => {
        const r1 = await attemptGenerate(candidates, options, 1);
        if (r1.value !== undefined) return r1.value;
        if (!r1.allTransient) throw r1.lastErr;
        console.warn(
          `[fallback] entire chain failed transiently, waiting ${retryDelayMs()}ms then retrying once`,
        );
        await sleep(retryDelayMs());
        const r2 = await attemptGenerate(candidates, options, candidates.length + 1);
        if (r2.value !== undefined) return r2.value;
        throw r2.lastErr;
      });
    },
    async doStream(options) {
      return runWithServedCandidate(async () => {
        const r1 = await attemptStream(candidates, options, 1);
        if (r1.value !== undefined) return r1.value;
        if (!r1.allTransient) throw r1.lastErr;
        console.warn(
          `[fallback] entire chain failed transiently, waiting ${retryDelayMs()}ms then retrying once`,
        );
        await sleep(retryDelayMs());
        const r2 = await attemptStream(candidates, options, candidates.length + 1);
        if (r2.value !== undefined) return r2.value;
        throw r2.lastErr;
      });
    },
  };
}
