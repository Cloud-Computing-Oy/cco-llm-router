import type { LanguageModel } from 'ai';
import { anthropicAvailable, anthropicModel } from './providers/anthropic.js';
import { googleAvailable, googleModel } from './providers/google.js';
import { openaiAvailable, openaiModel } from './providers/openai.js';
import { groqAvailable, groqModel } from './providers/groq.js';
import { openrouterAvailable, openrouterModel } from './providers/openrouter.js';
import { ollamaAvailable, ollamaModel } from './providers/ollama.js';
import { createFallbackModel } from './fallback.js';

export type Provider =
  | 'anthropic'
  | 'google'
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
 *   ollama:*               free (compute amortised on dev host)
 *   groq:llama-3.3-70b     free (rate-limited)
 *   openrouter:*:free      free (small daily cap per account)
 *   google:gemini-2.5-flash  $0.075 / $0.30
 *   google:gemini-2.5-pro    $1.25  / $5.00
 *   anthropic:claude-sonnet-4-6  $3 / $15
 *   anthropic:claude-haiku-4-5   $1 / $5
 *   openai:gpt-5-mini       ~$0.25 / $2
 *   openai:gpt-5            ~$3   / $15
 */
export const DEFAULT_ALIASES: Record<string, Spec[]> = {
  // Latency-sensitive chat. Cheapest smart-tier first; premium fallbacks
  // pick up the slack only on real failure / quota events. Groq is a
  // free option but rate-limited, so it lands at the bottom.
  'auto:smart': [
    { provider: 'google', model: 'gemini-2.5-flash' },     // $0.075/$0.30 — primary
    { provider: 'anthropic', model: 'claude-sonnet-4-6' }, // $3/$15 — fallback
    { provider: 'openai', model: 'gpt-5' },                // $3/$15 — fallback
    { provider: 'groq', model: 'llama-3.3-70b-versatile' }, // free — last-ditch
  ],
  // Cheap & fast for classification / language detection / short tasks.
  // Free providers first, paid mini-tier as backup.
  'auto:fast': [
    { provider: 'groq', model: 'llama-3.3-70b-versatile' }, // free + fastest
    { provider: 'google', model: 'gemini-2.5-flash' },      // $0.075
    { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' }, // $1
    { provider: 'openai', model: 'gpt-5-mini' },            // $0.25
  ],
  // Batch translation: latency doesn't matter, $$$ does. Free Gemma
  // first, paid Gemini Flash as the smallest possible cloud spend.
  'auto:translate': [
    { provider: 'ollama', model: 'gemma4:26b' },           // free
    { provider: 'google', model: 'gemini-2.5-flash' },     // $0.075
    { provider: 'anthropic', model: 'claude-sonnet-4-6' }, // $3 — last resort
  ],
  // High-reasoning tier (planning, math, multi-step). Quality matters
  // here, but Gemini-Pro is good enough for ~80% of cases at ~50%
  // the cost of gpt-5/sonnet.
  'auto:reasoning': [
    { provider: 'google', model: 'gemini-2.5-pro' },       // $1.25/$5
    { provider: 'anthropic', model: 'claude-sonnet-4-6' }, // $3/$15
    { provider: 'openai', model: 'gpt-5' },                // $3/$15
  ],
  // Cost-first: only free providers, falls into cheapest paid as last resort.
  'auto:cheap': [
    { provider: 'ollama', model: 'gemma4:26b' },
    { provider: 'groq', model: 'llama-3.3-70b-versatile' },
    { provider: 'openrouter', model: 'qwen/qwen3-coder:free' },
    { provider: 'google', model: 'gemini-2.5-flash' },
  ],
};

function providerAvailable(p: Provider): boolean {
  switch (p) {
    case 'anthropic':
      return anthropicAvailable;
    case 'google':
      return googleAvailable;
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
    const direct = alias.match(/^(anthropic|google|openai|groq|openrouter|ollama):(.+)$/);
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

// Singleton with the default config, for the 80% case where no overrides
// are needed.
const defaultRouter = createRouter();
export const resolveModel = defaultRouter.resolveModel;
export const listAliases = defaultRouter.listAliases;
