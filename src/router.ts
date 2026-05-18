import type { LanguageModel } from 'ai';
import { anthropicAvailable, anthropicModel } from './providers/anthropic';
import { googleAvailable, googleModel } from './providers/google';
import { googlePaidAvailable, googlePaidModel } from './providers/google-paid';
import { openaiAvailable, openaiModel } from './providers/openai';
import { groqAvailable, groqModel } from './providers/groq';
import { openrouterAvailable, openrouterModel } from './providers/openrouter';
import { ollamaAvailable, ollamaModel } from './providers/ollama';
import { createFallbackModel } from './fallback';

export type Provider =
  | 'anthropic'
  | 'google'
  | 'google-paid'
  | 'openai'
  | 'groq'
  | 'openrouter'
  | 'ollama';

export type Spec = { provider: Provider; model: string };

/**
 * Default fallback chains. Cost-first wherever quality allows: free /
 * local providers lead, paid cloud providers serve as fallbacks. Override
 * per-service via createRouter({ aliases }).
 *
 * Cost reference (input / output per M tokens, May 2026):
 *   ollama:*               free (compute on dev / local box)
 *   groq:llama-3.3-70b     free (rate-limited)
 *   openrouter:*:free      free (small daily cap per account)
 *   google:gemini-2.5-flash      free tier — 1500 RPD per GCP project
 *   google-paid:gemini-2.5-flash $0.075 / $0.30
 *   google-paid:gemini-2.5-pro   $1.25  / $5.00
 *   anthropic:claude-sonnet-4-6  $3 / $15
 *   anthropic:claude-haiku-4-5   $1 / $5
 *   openai:gpt-5-mini      ~$0.25 / $2
 *   openai:gpt-5           ~$3   / $15
 */
export const DEFAULT_ALIASES: Record<string, Spec[]> = {
  // Chat / generic. Free first; paid only when needed.
  'auto:smart': [
    { provider: 'google', model: 'gemini-2.5-flash' },
    { provider: 'openrouter', model: 'qwen/qwen3-next-80b-a3b-instruct:free' },
    { provider: 'openrouter', model: 'nvidia/nemotron-3-super-120b-a12b:free' },
    { provider: 'google-paid', model: 'gemini-2.5-flash' },
    { provider: 'google', model: 'gemini-2.5-pro' },
    { provider: 'google-paid', model: 'gemini-2.5-pro' },
    { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    { provider: 'openai', model: 'gpt-5' },
    { provider: 'ollama', model: 'qwen2.5-coder:14b' },
  ],
  // Classification, language detection, short tasks.
  'auto:fast': [
    { provider: 'groq', model: 'llama-3.3-70b-versatile' },
    { provider: 'google', model: 'gemini-2.5-flash' },
    { provider: 'openrouter', model: 'nvidia/nemotron-3-nano-30b-a3b:free' },
    { provider: 'openrouter', model: 'minimax/minimax-m2.5:free' },
    { provider: 'google-paid', model: 'gemini-2.5-flash' },
    { provider: 'openai', model: 'gpt-5-mini' },
    { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
    { provider: 'ollama', model: 'gemma4:e4b' },
  ],
  // Batch translation: latency-tolerant, free first. Qwen2.5:14b is the
  // primary translator after the expat-aivozone corpus build showed
  // Gemma 26B occasionally returns HTTP 200 with an empty body for
  // legal-text chunks — qwen2.5:14b did not exhibit that on the same
  // workload and ran ~5× faster on GPU-capable hosts than gemma 26B on
  // CPU-only Ollama hosts. Falls through to Gemini/Anthropic if Ollama
  // is unreachable or the model isn't pulled.
  'auto:translate': [
    { provider: 'ollama', model: 'qwen2.5:14b' },
    { provider: 'google', model: 'gemini-2.5-flash' },
    { provider: 'google-paid', model: 'gemini-2.5-flash' },
    { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  ],
  // Code generation / completion.
  'auto:code': [
    { provider: 'google', model: 'gemini-2.5-flash' },
    { provider: 'openrouter', model: 'qwen/qwen3-coder:free' },
    { provider: 'groq', model: 'llama-3.3-70b-versatile' },
    { provider: 'google-paid', model: 'gemini-2.5-flash' },
    { provider: 'openai', model: 'gpt-5-mini' },
    { provider: 'ollama', model: 'qwen2.5-coder:14b' },
  ],
  // Reasoning / planning / multi-step.
  'auto:reasoning': [
    { provider: 'google', model: 'gemini-2.5-pro' },
    { provider: 'google-paid', model: 'gemini-2.5-pro' },
    { provider: 'openrouter', model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free' },
    { provider: 'openrouter', model: 'arcee-ai/trinity-large-thinking:free' },
    { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    { provider: 'openai', model: 'gpt-5' },
  ],
  // Explicit paid only — for tasks where you want top quality and budget is approved.
  'auto:paid': [
    { provider: 'openai', model: 'gpt-5' },
    { provider: 'openai', model: 'gpt-5-mini' },
    { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    { provider: 'google-paid', model: 'gemini-2.5-pro' },
  ],
  // Large-context tasks (long docs, big diffs).
  'auto:big': [
    { provider: 'openrouter', model: 'google/gemma-4-31b-it:free' },
    { provider: 'openrouter', model: 'google/gemma-4-26b-a4b-it:free' },
    { provider: 'google', model: 'gemini-2.5-pro' },
    { provider: 'google-paid', model: 'gemini-2.5-pro' },
    { provider: 'openai', model: 'gpt-5' },
    { provider: 'ollama', model: 'gemma4:26b' },
  ],
  // Local-only — for fully offline / air-gapped paths.
  'auto:local': [
    { provider: 'ollama', model: 'qwen2.5-coder:14b' },
    { provider: 'ollama', model: 'gemma4:e4b' },
  ],
  // Cost-first: only free providers, falls into cheapest paid as last resort.
  'auto:cheap': [
    { provider: 'ollama', model: 'gemma4:e4b' },
    { provider: 'openrouter', model: 'minimax/minimax-m2.5:free' },
    { provider: 'groq', model: 'llama-3.3-70b-versatile' },
    { provider: 'google', model: 'gemini-2.5-flash' },
    { provider: 'google-paid', model: 'gemini-2.5-flash' },
    { provider: 'openai', model: 'gpt-5-mini' },
  ],
};

function providerAvailable(p: Provider): boolean {
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
  }
}

function instantiate(spec: Spec): LanguageModel {
  switch (spec.provider) {
    case 'anthropic':
      return anthropicModel(spec.model);
    case 'google':
      return googleModel(spec.model);
    case 'google-paid':
      return googlePaidModel(spec.model);
    case 'openai':
      return openaiModel(spec.model);
    case 'groq':
      return groqModel(spec.model);
    case 'openrouter':
      return openrouterModel(spec.model);
    case 'ollama':
      return ollamaModel(spec.model);
  }
}

function specLabel(s: Spec): string {
  return `${s.provider}:${s.model}`;
}

export type RouterOptions = {
  /** Override or extend the default alias map. */
  aliases?: Record<string, Spec[]>;
};

export type Router = {
  resolveModel: (alias: string) => { model: LanguageModel; specs: Spec[] };
  listAliases: () => Array<{ alias: string; chain: Spec[]; availableCount: number }>;
};

export function createRouter(opts: RouterOptions = {}): Router {
  const aliases = { ...DEFAULT_ALIASES, ...(opts.aliases ?? {}) };

  function resolveModel(alias: string): { model: LanguageModel; specs: Spec[] } {
    const direct = alias.match(
      /^(anthropic|google|google-paid|openai|groq|openrouter|ollama):(.+)$/,
    );
    if (direct) {
      const spec: Spec = { provider: direct[1] as Provider, model: direct[2] };
      if (!providerAvailable(spec.provider)) {
        throw new Error(`Provider not available: ${spec.provider} (missing API key?)`);
      }
      return { model: instantiate(spec), specs: [spec] };
    }
    const chain = aliases[alias];
    if (!chain) throw new Error(`Unknown model alias: ${alias}`);
    const available = chain.filter((s) => providerAvailable(s.provider));
    if (available.length === 0) {
      throw new Error(`No available provider for alias ${alias} — set at least one API key`);
    }
    if (available.length === 1) return { model: instantiate(available[0]), specs: available };
    const inner = available.map((s) => ({ label: specLabel(s), model: instantiate(s) }));
    return { model: createFallbackModel(inner) as LanguageModel, specs: available };
  }

  function listAliases() {
    return Object.entries(aliases).map(([alias, chain]) => ({
      alias,
      chain,
      availableCount: chain.filter((s) => providerAvailable(s.provider)).length,
    }));
  }

  return { resolveModel, listAliases };
}

// Default singleton.
const defaultRouter = createRouter();
export const resolveModel = defaultRouter.resolveModel;
export const listAliases = defaultRouter.listAliases;
