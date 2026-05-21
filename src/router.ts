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
export const DEFAULT_ALIASES: Record<string, Spec[]> = {
  // Chat / generic. Strict cost-first: own-server Ollama leads (zero
  // marginal cost on GPU-capable dev/prod hosts), then free cloud tiers,
  // then DeepInfra as ultra-cheap paid buffer before Google paid /
  // Anthropic / OpenAI. Ollama spec at the head is no-op on hosts where
  // OLLAMA_BASE_URL is unset (e.g. CI), since `providerAvailable` skips it.
  'auto:smart': [
    { provider: 'ollama', model: 'qwen2.5:14b' },
    { provider: 'google', model: 'gemini-2.5-flash' },
    { provider: 'openrouter', model: 'qwen/qwen3-next-80b-a3b-instruct:free' },
    { provider: 'openrouter', model: 'nvidia/nemotron-3-super-120b-a12b:free' },
    { provider: 'deepinfra', model: 'meta-llama/Meta-Llama-3.3-70B-Instruct' },
    { provider: 'google-paid', model: 'gemini-2.5-flash' },
    { provider: 'together', model: 'meta-llama/Llama-3.3-70B-Instruct-Lite' },
    { provider: 'google', model: 'gemini-2.5-pro' },
    { provider: 'google-paid', model: 'gemini-2.5-pro' },
    { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    { provider: 'openai', model: 'gpt-5' },
  ],
  // Classification, language detection, short tasks. Local 2B model
  // first (tiny, GPU-cached), then Groq / free cloud / paid fallbacks.
  'auto:fast': [
    { provider: 'ollama', model: 'gemma4:e2b' },
    { provider: 'groq', model: 'llama-3.3-70b-versatile' },
    { provider: 'google', model: 'gemini-2.5-flash' },
    { provider: 'openrouter', model: 'nvidia/nemotron-3-nano-30b-a3b:free' },
    { provider: 'openrouter', model: 'minimax/minimax-m2.5:free' },
    { provider: 'deepinfra', model: 'meta-llama/Meta-Llama-3.1-8B-Instruct' },
    { provider: 'google-paid', model: 'gemini-2.5-flash' },
    { provider: 'openai', model: 'gpt-5-mini' },
    { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  ],
  // Batch translation: latency-tolerant, free first. Qwen2.5:14b is the
  // primary translator after the expat-aivozone corpus build showed
  // Gemma 26B occasionally returns HTTP 200 with an empty body for
  // legal-text chunks — qwen2.5:14b did not exhibit that on the same
  // workload and ran ~5× faster on GPU-capable hosts than gemma 26B on
  // CPU-only Ollama hosts. Falls through to Gemini/DeepInfra/Anthropic
  // if Ollama is unreachable or the model isn't pulled.
  'auto:translate': [
    { provider: 'ollama', model: 'qwen2.5:14b' },
    { provider: 'google', model: 'gemini-2.5-flash' },
    { provider: 'deepinfra', model: 'meta-llama/Meta-Llama-3.3-70B-Instruct' },
    { provider: 'google-paid', model: 'gemini-2.5-flash' },
    { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  ],
  // Code generation / completion. qwen2.5:14b on Ollama is a competent
  // local default (no coder variant installed on the fleet — see fleet
  // ollama inventory). Falls through to Gemini / OpenRouter qwen-coder
  // free / Groq, then paid.
  'auto:code': [
    { provider: 'ollama', model: 'qwen2.5:14b' },
    { provider: 'google', model: 'gemini-2.5-flash' },
    { provider: 'openrouter', model: 'qwen/qwen3-coder:free' },
    { provider: 'groq', model: 'llama-3.3-70b-versatile' },
    { provider: 'deepinfra', model: 'meta-llama/Meta-Llama-3.3-70B-Instruct' },
    { provider: 'google-paid', model: 'gemini-2.5-flash' },
    { provider: 'openai', model: 'gpt-5-mini' },
  ],
  // Reasoning / planning / multi-step. Cloud-first because no
  // installed local model is reasoning-grade (qwen2.5 has no thinking
  // mode, gemma4:26b is large but lacks chain-of-thought structure).
  // DeepSeek-V3 on DeepInfra is the cheapest "thinking-grade" model
  // after free tiers. Ollama appended as final fallback so an
  // air-gapped path still resolves.
  'auto:reasoning': [
    { provider: 'google', model: 'gemini-2.5-pro' },
    { provider: 'openrouter', model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free' },
    { provider: 'openrouter', model: 'arcee-ai/trinity-large-thinking:free' },
    { provider: 'deepinfra', model: 'deepseek-ai/DeepSeek-V3' },
    { provider: 'google-paid', model: 'gemini-2.5-pro' },
    { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    { provider: 'openai', model: 'gpt-5' },
    { provider: 'ollama', model: 'qwen2.5:14b' },
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
  'auto:big': [
    { provider: 'ollama', model: 'gemma4:26b' },
    { provider: 'openrouter', model: 'google/gemma-4-31b-it:free' },
    { provider: 'openrouter', model: 'google/gemma-4-26b-a4b-it:free' },
    { provider: 'google', model: 'gemini-2.5-pro' },
    { provider: 'deepinfra', model: 'meta-llama/Meta-Llama-3.3-70B-Instruct' },
    { provider: 'google-paid', model: 'gemini-2.5-pro' },
    { provider: 'openai', model: 'gpt-5' },
  ],
  // Local-only — for fully offline / air-gapped paths. Both models on
  // the dev/prod ollama inventory (see fleet docs).
  'auto:local': [
    { provider: 'ollama', model: 'qwen2.5:14b' },
    { provider: 'ollama', model: 'gemma4:e2b' },
  ],
  // Cost-first: only free + ultra-cheap providers; expensive tiers excluded.
  'auto:cheap': [
    { provider: 'ollama', model: 'gemma4:e2b' },
    { provider: 'openrouter', model: 'minimax/minimax-m2.5:free' },
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
