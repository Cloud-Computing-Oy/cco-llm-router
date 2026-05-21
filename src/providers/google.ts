import { createGoogleGenerativeAI } from '@ai-sdk/google';

/**
 * Free / metered Google Gemini provider with multi-key support + BYOK.
 *
 * Two key sources are supported, in this priority order at call time:
 *   1. `opts.apiKey` (per-call BYOK) — request-scoped override, e.g.
 *      Invoicify passes a tenant key via AsyncLocalStorage. A fresh
 *      provider is created per call so concurrent BYOK requests don't
 *      collide; budget enforcement still applies upstream in the router.
 *   2. The env pool, indexed by `opts.keyIndex` (default 0).
 *
 * Env pool: each free Google AI Studio key has its own per-GCP-project
 * quota (1500 RPD on Gemini 2.5 Flash). The Cloud-Computing-Oy fleet
 * provisions one key per distinct GCP project so the effective
 * free-tier ceiling scales with the number of keys (4 keys → 6000 RPD,
 * etc.).
 *
 * Env-pool keys are read in this order; the first gap stops the scan:
 *   - GOOGLE_GENERATIVE_AI_API_KEY               (primary, official Vercel AI SDK name)
 *   - GEMINI_API_KEY                             (back-compat alias for the primary slot)
 *   - GOOGLE_GENAI_API_KEY                       (Invoicify / LexAI naming for the primary slot)
 *   - GOOGLE_GENERATIVE_AI_API_KEY_2 .. _N       (extra slots, consecutive)
 *
 * The router (`router.ts`) expands a single `google:` chain entry into
 * one entry per available pool key so the existing fallback chain
 * rotates through them on 429 / per-day quota errors before falling
 * through to the next provider. The paid-tier key lives in the separate
 * `google-paid` provider — keeping them apart lets us chain
 * 'free pool first, paid key on quota exhaustion'.
 */

function collectKeys(): string[] {
  const keys: string[] = [];
  const primary =
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ??
    process.env.GOOGLE_GENAI_API_KEY ??
    process.env.GEMINI_API_KEY;
  if (primary) keys.push(primary);
  for (let i = 2; ; i++) {
    const k = process.env[`GOOGLE_GENERATIVE_AI_API_KEY_${i}`];
    if (!k) break;
    keys.push(k);
  }
  return keys;
}

const envProviders = collectKeys().map((apiKey) => createGoogleGenerativeAI({ apiKey }));

export const googleAvailable = envProviders.length > 0;
export const googleKeyCount = envProviders.length;

export function googleModel(name: string, opts: { apiKey?: string; keyIndex?: number } = {}) {
  if (opts.apiKey) {
    return createGoogleGenerativeAI({ apiKey: opts.apiKey })(name);
  }
  const idx = opts.keyIndex ?? 0;
  const p = envProviders[idx];
  if (!p) {
    throw new Error(
      `Google key index ${idx} not available (have ${envProviders.length} env key(s); set GOOGLE_GENERATIVE_AI_API_KEY[_2..N] or pass opts.apiKey)`,
    );
  }
  return p(name);
}
