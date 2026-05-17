import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { LanguageModel } from 'ai';

type Inner = { label: string; model: LanguageModel };

const SHOULD_FALLBACK_PATTERNS = [
  /invalid.*api.?key/i,
  /unauthor/i,
  /403/,
  /401/,
  /rate.?limit/i,
  /quota/i,
  /429/,
  /model.*not.*found/i,
  /404/,
  /no endpoints found/i,
  /service unavailable/i,
  /503/,
  /decommissioned/i,
  /no longer supported/i,
  /deprecated/i,
  /tokens per minute/i,
  /context.*length/i,
  /econnrefused/i,
  /econnreset/i,
  /etimedout/i,
  /socket hang up/i,
  /fetch failed/i,
];

function shouldFallback(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return SHOULD_FALLBACK_PATTERNS.some((p) => p.test(msg));
}

const RETRY_DELAY_MS = 8_000;

function isTransientRateLimit(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return /rate.?limit|429|quota|tokens per minute|service unavailable|503/i.test(msg);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function attemptChain<T>(
  candidates: Inner[],
  call: (m: LanguageModelV3) => Promise<T>,
): Promise<{ value?: T; lastErr?: unknown }> {
  let lastErr: unknown;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    try {
      const value = await call(c.model as LanguageModelV3);
      return { value };
    } catch (err) {
      lastErr = err;
      const reason = err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120);
      if (!shouldFallback(err) || i === candidates.length - 1) {
        console.warn(`[fallback] ${c.label} failed (terminal): ${reason}`);
        return { lastErr: err };
      }
      console.warn(`[fallback] ${c.label} failed: ${reason} — trying next`);
    }
  }
  return { lastErr };
}

export function createFallbackModel(candidates: Inner[]): LanguageModelV3 {
  if (candidates.length === 0) throw new Error('createFallbackModel: empty candidate list');

  const first = candidates[0].model as LanguageModelV3;

  const runWithRetry = async <T>(call: (m: LanguageModelV3) => Promise<T>): Promise<T> => {
    const r1 = await attemptChain(candidates, call);
    if (r1.value !== undefined) return r1.value;
    if (!isTransientRateLimit(r1.lastErr)) throw r1.lastErr;
    console.warn(`[fallback] entire chain rate-limited, waiting ${RETRY_DELAY_MS}ms then retrying once`);
    await sleep(RETRY_DELAY_MS);
    const r2 = await attemptChain(candidates, call);
    if (r2.value !== undefined) return r2.value;
    throw r2.lastErr;
  };

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
      return runWithRetry((m) => Promise.resolve(m.doGenerate(options)));
    },
    async doStream(options) {
      return runWithRetry((m) => Promise.resolve(m.doStream(options)));
    },
  };
}
