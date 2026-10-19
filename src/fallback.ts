import type { LanguageModelV3, LanguageModelV3Usage } from '@ai-sdk/provider';
import type { LanguageModel } from 'ai';
import type { Provider } from './types';
import { recordUsage } from './usage';
import { checkThresholds } from './budget';
import { acquireOllamaLease } from './ollama-gate';
import { getBudgetContext, getBudgetHooks } from './budget-hooks';
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
  return {
    inputTokens: usage.inputTokens?.total ?? 0,
    outputTokens: usage.outputTokens?.total ?? 0,
  };
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
  if (!context) throw new Error('budget context puuttuu managed callilta');
  const maxOutputTokens =
    (options as { maxOutputTokens?: number }).maxOutputTokens ?? 4096;
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
    try {
      reservationId = await reserveFor(c, i, attempt, options);
      if (c.provider === 'ollama') ollamaLease = await acquireOllamaLease(c.modelId);
      const operation = () => (c.model as LanguageModelV3).doGenerate(options);
      const result = ollamaLease ? await ollamaLease.run(operation) : await operation();
      const served = servedRecord(c, i, attempt, true, usageOf(result.usage));
      recordServedCandidate(served);
      tryRecord(c, result.usage);
      await settleFor(reservationId, usageOf(result.usage) ?? null, served);
      return { value: result, allTransient: false };
    } catch (err) {
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
    } finally {
      ollamaLease?.release();
    }
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
    try {
      reservationId = await reserveFor(c, i, attempt, options);
      if (c.provider === 'ollama') ollamaLease = await acquireOllamaLease(c.modelId);
      const operation = () => (c.model as LanguageModelV3).doStream(options);
      const result = ollamaLease ? await ollamaLease.run(operation) : await operation();
      // Tap the stream: forward all parts to the consumer while capturing
      // the final usage block, then record on completion. This requires
      // teeing the stream through a TransformStream.
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
    } catch (err) {
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
    } finally {
      if (!releaseWithStream) ollamaLease?.release();
    }
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
  const finish = () => {
    if (done) return;
    done = true;
    onDone?.();
  };
  const reader = stream.getReader();
  return new ReadableStream({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
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
            recordServedCandidateTo(store, served);
            void settleFor(reservationId, null, served).catch(() => undefined);
          }
        }
        if (part?.type === 'finish' && part.usage) {
          recorded = true;
          const served = servedRecord(c, chainIndex, attempt, true, usageOf(part.usage));
          recordServedCandidateTo(store, served);
          tryRecord(c, part.usage);
          void settleFor(reservationId, served.usage ?? null, served).catch((e) => {
            console.error('[budget] stream settle failed:', e instanceof Error ? e.message : String(e));
          });
        }
        controller.enqueue(result.value);
      } catch (error) {
        if (!recorded) {
          recorded = true;
          const served = servedRecord(c, chainIndex, attempt, false, undefined, errorClassOf(error));
          recordServedCandidateTo(store, served);
          void settleFor(reservationId, null, served).catch(() => undefined);
        }
        finish();
        controller.error(error);
      }
    },
    async cancel(reason) {
      // A consumer may cancel after the finish part was recorded; that must
      // not overwrite a successful outcome with an abort.
      if (!recorded) {
        recorded = true;
        const served = servedRecord(c, chainIndex, attempt, false, undefined, 'abort');
        recordServedCandidateTo(store, served);
        void settleFor(reservationId, null, served).catch(() => undefined);
      }
      finish();
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
