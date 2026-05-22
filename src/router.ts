import type { LanguageModel } from 'ai';
import { anthropicAvailable, anthropicModel } from './providers/anthropic';
import { googleAvailable, googleKeyCount, googleModel } from './providers/google';
import { googlePaidAvailable, googlePaidModel } from './providers/google-paid';
import { openaiAvailable, openaiModel } from './providers/openai';
import { groqAvailable, groqModel } from './providers/groq';
import { openrouterAvailable, openrouterModel } from './providers/openrouter';
import { ollamaAvailable, ollamaModel } from './providers/ollama';
import { deepinfraAvailable, deepinfraModel } from './providers/deepinfra';
import { togetherAvailable, togetherModel } from './providers/together';
import { createFallbackModel } from './fallback';
import { withinBudget } from './budget';

export type { Provider, Spec } from './types';
import type { Provider, Spec } from './types';

/**
 * Default fallback chains. Cost-first wherever quality allows: free /
 * local providers lead, paid cloud providers serve as fallbacks. Override
 * per-service via createRouter({ aliases }).
 *
 * Cost reference (input / output per M tokens, May 2026):
 *   ollama:*                         free (compute on dev / local box)
 *   groq:llama-3.3-70b               free (rate-limited)
 *   openrouter:*:free                free (small daily cap per account)
 *   google:gemini-2.5-flash          free tier — 1500 RPD per GCP project
 *   deepinfra:llama-3.1-8b           $0.04 / $0.04   (ultra-cheap tier)
 *   google-paid:gemini-2.5-flash     $0.075 / $0.30
 *   deepinfra:llama-3.3-70b          $0.23  / $0.40
 *   together:llama-3.3-70b-lite      $0.54  / $0.88
 *   openai:gpt-5-mini                $0.25  / $2
 *   google-paid:gemini-2.5-pro       $1.25  / $5
 *   anthropic:claude-haiku-4-5       $1     / $5
 *   anthropic:claude-sonnet-4-6      $3     / $15
 *   openai:gpt-5                     $3     / $15
 *
 * Cost ordering: free → ultra-cheap → cheap → expensive. The ultra-cheap
 * tier (DeepInfra) is a critical buffer between exhausted free tiers and
 * 5–10× pricier provider tiers.
 */
// Default fallback chains.
//
// **OpenRouter free-tier models and Ollama are EXCLUDED from every default
// alias** (as of 0.8.0). Field-tested 2026-05-22:
//   - OpenRouter free models (qwen3-next, nemotron-3, gemma-4-*-it:free)
//     ignore structured-output instructions and emit prose, which crashes
//     downstream JSON.parse in caller flows. No SLA on free tier.
//   - Ollama on CPU-only dev/hub hosts (no GPU drivers, 3.7 GB RAM on hub)
//     does not satisfy a 60 s timeout on real prompts.
// They remain selectable via `auto:local` and explicit aliases below for
// callers who can guarantee a GPU host / tolerate prose. They will be
// re-enabled in defaults once they pass a smoke-test SLA.
export const DEFAULT_ALIASES: Record<string, Spec[]> = {
  // Chat / generic. Reliable providers first.
  'auto:smart': [
    { provider: 'google', model: 'gemini-2.5-flash' },
    { provider: 'deepinfra', model: 'meta-llama/Meta-Llama-3.3-70B-Instruct' },
    { provider: 'google-paid', model: 'gemini-2.5-flash' },
    { provider: 'together', model: 'meta-llama/Llama-3.3-70B-Instruct-Lite' },
    { provider: 'google', model: 'gemini-2.5-pro' },
    { provider: 'google-paid', model: 'gemini-2.5-pro' },
    { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    { provider: 'openai', model: 'gpt-5' },
  ],
  // Classification, language detection, short tasks.
  'auto:fast': [
    { provider: 'groq', model: 'llama-3.3-70b-versatile' },
    { provider: 'google', model: 'gemini-2.5-flash' },
    { provider: 'deepinfra', model: 'meta-llama/Meta-Llama-3.1-8B-Instruct' },
    { provider: 'google-paid', model: 'gemini-2.5-flash' },
    { provider: 'openai', model: 'gpt-5-mini' },
    { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  ],
  // Batch translation: latency-tolerant, free Google quota first.
  'auto:translate': [
    { provider: 'google', model: 'gemini-2.5-flash' },
    { provider: 'deepinfra', model: 'meta-llama/Meta-Llama-3.3-70B-Instruct' },
    { provider: 'google-paid', model: 'gemini-2.5-flash' },
    { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  ],
  // Code generation / completion.
  'auto:code': [
    { provider: 'google', model: 'gemini-2.5-flash' },
    { provider: 'groq', model: 'llama-3.3-70b-versatile' },
    { provider: 'deepinfra', model: 'meta-llama/Meta-Llama-3.3-70B-Instruct' },
    { provider: 'google-paid', model: 'gemini-2.5-flash' },
    { provider: 'openai', model: 'gpt-5-mini' },
  ],
  // Reasoning / planning / multi-step.
  'auto:reasoning': [
    { provider: 'google', model: 'gemini-2.5-pro' },
    { provider: 'deepinfra', model: 'deepseek-ai/DeepSeek-V3' },
    { provider: 'google-paid', model: 'gemini-2.5-pro' },
    { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    { provider: 'openai', model: 'gpt-5' },
  ],
  // Explicit paid only — for tasks where top quality is needed and budget approved.
  'auto:paid': [
    { provider: 'openai', model: 'gpt-5' },
    { provider: 'openai', model: 'gpt-5-mini' },
    { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    { provider: 'google-paid', model: 'gemini-2.5-pro' },
  ],
  // Large-context tasks (long docs, big diffs). Local gemma4:26b leads
  // because long-context prompts on the cloud free tier consume the
  // 1500-RPD quota quickly.
  // Large-context tasks (long docs, big diffs).
  'auto:big': [
    { provider: 'google', model: 'gemini-2.5-pro' },
    { provider: 'deepinfra', model: 'meta-llama/Meta-Llama-3.3-70B-Instruct' },
    { provider: 'google-paid', model: 'gemini-2.5-pro' },
    { provider: 'openai', model: 'gpt-5' },
  ],
  // Local-only — for fully offline / air-gapped paths. Opt-in: callers must
  // explicitly select this alias. Not safe as a default fallback because
  // CPU-only hosts (current dev/hub fleet) miss the 60 s timeout.
  'auto:local': [
    { provider: 'ollama', model: 'qwen2.5:14b' },
    { provider: 'ollama', model: 'gemma4:e2b' },
  ],
  // Cost-first: free + ultra-cheap providers; expensive tiers excluded.
  // Excludes ollama (unreliable on CPU hosts) and openrouter:free (prose).
  'auto:cheap': [
    { provider: 'groq', model: 'llama-3.3-70b-versatile' },
    { provider: 'google', model: 'gemini-2.5-flash' },
    { provider: 'deepinfra', model: 'meta-llama/Meta-Llama-3.1-8B-Instruct' },
    { provider: 'deepinfra', model: 'meta-llama/Meta-Llama-3.3-70B-Instruct' },
    { provider: 'google-paid', model: 'gemini-2.5-flash' },
  ],
};

function hasKey(p: Provider): boolean {
  switch (p) {
    case 'anthropic':
      return anthropicAvailable;
    case 'google':
      return googleAvailable;
    case 'google-paid':
      return googlePaidAvailable;
    case 'openai':
      return openaiAvailable;
    case 'groq':
      return groqAvailable;
    case 'openrouter':
      return openrouterAvailable;
    case 'ollama':
      return ollamaAvailable;
    case 'deepinfra':
      return deepinfraAvailable;
    case 'together':
      return togetherAvailable;
  }
}

function providerAvailable(p: Provider): boolean {
  return hasKey(p) && withinBudget(p);
}

export type PerCallKeys = Partial<Record<Exclude<Provider, 'ollama'>, string>>;

function instantiate(spec: Spec, perCallKeys?: PerCallKeys): LanguageModel {
  const opts = perCallKeys?.[spec.provider as keyof PerCallKeys]
    ? { apiKey: perCallKeys[spec.provider as keyof PerCallKeys]! }
    : undefined;
  switch (spec.provider) {
    case 'anthropic':
      return anthropicModel(spec.model, opts);
    case 'google':
      return googleModel(spec.model, { ...opts, keyIndex: spec.keyIndex ?? 0 });
    case 'google-paid':
      return googlePaidModel(spec.model, opts);
    case 'openai':
      return openaiModel(spec.model, opts);
    case 'groq':
      return groqModel(spec.model, opts);
    case 'openrouter':
      return openrouterModel(spec.model, opts);
    case 'ollama':
      return ollamaModel(spec.model);
    case 'deepinfra':
      return deepinfraModel(spec.model, opts);
    case 'together':
      return togetherModel(spec.model, opts);
  }
}

function specLabel(s: Spec): string {
  const keyTag = s.provider === 'google' && (s.keyIndex ?? 0) > 0 ? `#${s.keyIndex}` : '';
  return `${s.provider}:${s.model}${keyTag}`;
}

/**
 * Expand each `google` spec into N copies — one per available Google API
 * key. The fallback chain (createFallbackModel) rotates through them on
 * per-day quota / 429 errors before moving on to the next provider in
 * the chain. The original spec stays at its position; additional keys
 * are inserted immediately after it.
 *
 * No-op when fewer than 2 Google keys are configured.
 */
function expandGoogleKeys(chain: Spec[]): Spec[] {
  if (googleKeyCount <= 1) return chain;
  const out: Spec[] = [];
  for (const s of chain) {
    if (s.provider !== 'google') {
      out.push(s);
      continue;
    }
    for (let i = 0; i < googleKeyCount; i++) {
      out.push({ ...s, keyIndex: i });
    }
  }
  return out;
}

export type RouterOptions = {
  /** Override or extend the default alias map. */
  aliases?: Record<string, Spec[]>;
};

export type ResolveOptions = {
  /**
   * Per-call API key overrides. Use for BYOK consumers where each request
   * has tenant-scoped credentials (e.g. AsyncLocalStorage-backed keys).
   * Overridden providers count as available even when their env key is unset.
   */
  perCallKeys?: PerCallKeys;
};

export type Router = {
  resolveModel: (alias: string, opts?: ResolveOptions) => { model: LanguageModel; specs: Spec[] };
  listAliases: () => Array<{ alias: string; chain: Spec[]; availableCount: number }>;
};

const DIRECT_RE =
  /^(anthropic|google|google-paid|openai|groq|openrouter|ollama|deepinfra|together):(.+)$/;

export function createRouter(opts: RouterOptions = {}): Router {
  const aliases = { ...DEFAULT_ALIASES, ...(opts.aliases ?? {}) };

  function isAvailable(p: Provider, perCallKeys?: PerCallKeys): boolean {
    if (perCallKeys?.[p as keyof PerCallKeys]) return withinBudget(p);
    return providerAvailable(p);
  }

  function resolveModel(
    alias: string,
    callOpts: ResolveOptions = {},
  ): { model: LanguageModel; specs: Spec[] } {
    const perCallKeys = callOpts.perCallKeys;
    const direct = alias.match(DIRECT_RE);
    if (direct) {
      const spec: Spec = { provider: direct[1] as Provider, model: direct[2] };
      if (!hasKey(spec.provider) && !perCallKeys?.[spec.provider as keyof PerCallKeys]) {
        throw new Error(`Provider not available: ${spec.provider} (missing API key?)`);
      }
      // Direct calls bypass budget checks — caller asked for this exact model.
      return { model: instantiate(spec, perCallKeys), specs: [spec] };
    }
    const chain = aliases[alias];
    if (!chain) throw new Error(`Unknown model alias: ${alias}`);
    // When per-call keys are supplied, skip the env-pool expansion for
    // `google` — a BYOK key is a single concrete credential, not a pool.
    const filtered = chain.filter((s) => isAvailable(s.provider, perCallKeys));
    const available = perCallKeys?.google ? filtered : expandGoogleKeys(filtered);
    if (available.length === 0) {
      throw new Error(`No available provider for alias ${alias} — set at least one API key`);
    }
    if (available.length === 1) {
      return { model: instantiate(available[0], perCallKeys), specs: available };
    }
    const inner = available.map((s) => ({
      label: specLabel(s),
      provider: s.provider,
      modelId: s.model,
      model: instantiate(s, perCallKeys),
    }));
    return { model: createFallbackModel(inner) as LanguageModel, specs: available };
  }

  function listAliases() {
    return Object.entries(aliases).map(([alias, chain]) => {
      const available = expandGoogleKeys(chain.filter((s) => providerAvailable(s.provider)));
      return { alias, chain, availableCount: available.length };
    });
  }

  return { resolveModel, listAliases };
}

// Default singleton.
const defaultRouter = createRouter();
export const resolveModel = defaultRouter.resolveModel;
export const listAliases = defaultRouter.listAliases;
