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

/** Default fallback chains. Consumers can override via createRouter(). */
export const DEFAULT_ALIASES: Record<string, Spec[]> = {
  // Latency-sensitive chat. Google flash is the cheapest smart model;
  // anthropic + openai are paid premium fallbacks. Groq sits at the
  // bottom as a very-fast cheap option when available.
  'auto:smart': [
    { provider: 'google', model: 'gemini-2.5-flash' },
    { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    { provider: 'openai', model: 'gpt-5' },
    { provider: 'groq', model: 'llama-3.3-70b-versatile' },
  ],
  // Cheap & fast for classification / language detection / short tasks.
  'auto:fast': [
    { provider: 'groq', model: 'llama-3.3-70b-versatile' },
    { provider: 'google', model: 'gemini-2.5-flash' },
    { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
    { provider: 'openai', model: 'gpt-5-mini' },
  ],
  // Batch translation. Free local Gemma first; cloud picks up the slack.
  'auto:translate': [
    { provider: 'ollama', model: 'gemma4:26b' },
    { provider: 'google', model: 'gemini-2.5-flash' },
    { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  ],
  // High-reasoning tier (planning, math, multi-step).
  'auto:reasoning': [
    { provider: 'openai', model: 'gpt-5' },
    { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    { provider: 'google', model: 'gemini-2.5-pro' },
  ],
  // OpenRouter-hosted free / OSS models when paid budget is tight.
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
