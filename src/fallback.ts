import type { LanguageModelV3, LanguageModelV3Usage } from '@ai-sdk/provider';
import type { LanguageModel } from 'ai';
import type { Provider } from './types';
import { recordUsage } from './usage';
import { checkThresholds } from './budget';
import { acquireOllamaLease } from './ollama-gate';

type Inner = {
  label: string;
  provider: Provider;
  modelId: string;
  model: LanguageModel;
};

const TRANSIENT_PATTERNS = [
  /rate.?limit/i,
  /quota/i,
  /429/,
  /service unavailable/i,
  /503/,
  /tokens per minute/i,
  /econnrefused/i,
  /econnreset/i,
  /etimedout/i,
  /socket hang up/i,
  /fetch failed/i,
  /insufficient.*quota/i,
  /payment.*required/i,
  /402/,
  /ollama request exceeded/i,
];

function isTransient(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return TRANSIENT_PATTERNS.some((p) => p.test(msg));
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

const RETRY_DELAY_MS = 8_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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
): Promise<{ value?: GenerateResult; lastErr?: unknown; allTransient: boolean }> {
  let lastErr: unknown;
  let allTransient = true;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    let ollamaLease: Awaited<ReturnType<typeof acquireOllamaLease>> | undefined;
    try {
      if (c.provider === 'ollama') ollamaLease = await acquireOllamaLease(c.modelId);
      const operation = () => (c.model as LanguageModelV3).doGenerate(options);
      const result = ollamaLease ? await ollamaLease.run(operation) : await operation();
      tryRecord(c, result.usage);
      return { value: result, allTransient: false };
    } catch (err) {
      if (options.abortSignal?.aborted || isAbort(err)) throw err;
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
): Promise<{ value?: StreamResult; lastErr?: unknown; allTransient: boolean }> {
  let lastErr: unknown;
  let allTransient = true;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    let ollamaLease: Awaited<ReturnType<typeof acquireOllamaLease>> | undefined;
    let releaseWithStream = false;
    try {
      if (c.provider === 'ollama') ollamaLease = await acquireOllamaLease(c.modelId);
      const operation = () => (c.model as LanguageModelV3).doStream(options);
      const result = ollamaLease ? await ollamaLease.run(operation) : await operation();
      // Tap the stream: forward all parts to the consumer while capturing
      // the final usage block, then record on completion. This requires
      // teeing the stream through a TransformStream.
      const tapped = tapStreamForUsage(result.stream, c, ollamaLease?.release);
      releaseWithStream = Boolean(ollamaLease);
      return { value: { ...result, stream: tapped }, allTransient: false };
    } catch (err) {
      if (options.abortSignal?.aborted || isAbort(err)) throw err;
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
  onDone?: () => void,
): StreamResult['stream'] {
  let done = false;
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
        const part = result.value as { type?: string; usage?: LanguageModelV3Usage };
        if (part?.type === 'finish' && part.usage) tryRecord(c, part.usage);
        controller.enqueue(result.value);
      } catch (error) {
        finish();
        controller.error(error);
      }
    },
    async cancel(reason) {
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
      const r1 = await attemptGenerate(candidates, options);
      if (r1.value !== undefined) return r1.value;
      if (!r1.allTransient) throw r1.lastErr;
      console.warn(`[fallback] entire chain failed transiently, waiting ${RETRY_DELAY_MS}ms then retrying once`);
      await sleep(RETRY_DELAY_MS);
      const r2 = await attemptGenerate(candidates, options);
      if (r2.value !== undefined) return r2.value;
      throw r2.lastErr;
    },
    async doStream(options) {
      const r1 = await attemptStream(candidates, options);
      if (r1.value !== undefined) return r1.value;
      if (!r1.allTransient) throw r1.lastErr;
      console.warn(`[fallback] entire chain failed transiently, waiting ${RETRY_DELAY_MS}ms then retrying once`);
      await sleep(RETRY_DELAY_MS);
      const r2 = await attemptStream(candidates, options);
      if (r2.value !== undefined) return r2.value;
      throw r2.lastErr;
    },
  };
}
