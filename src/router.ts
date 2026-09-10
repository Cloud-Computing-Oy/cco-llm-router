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
import { deepseekAvailable, deepseekModel } from './providers/deepseek';
import { moonshotAvailable, moonshotModel } from './providers/moonshot';
import { dashscopeAvailable, dashscopeModel } from './providers/dashscope';
import { zaiAvailable, zaiModel } from './providers/zai';
import { minimaxAvailable, minimaxModel } from './providers/minimax';
import { mistralAvailable, mistralModel } from './providers/mistral';
import { nvidiaAvailable, nvidiaModel } from './providers/nvidia';
import { createFallbackModel } from './fallback';
import { withinBudget } from './budget';
import { hasReviewedAutomaticPricing, requiresUnknownPricingApproval } from './catalog';
import { DEFAULT_ALIASES } from './aliases';

export type { Provider, Spec } from './types';
import type { Provider, Spec } from './types';

export { DEFAULT_ALIASES };

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
    case 'deepseek':
      return deepseekAvailable;
    case 'moonshot':
      return moonshotAvailable;
    case 'dashscope':
      return dashscopeAvailable;
    case 'zai':
      return zaiAvailable;
    case 'minimax':
      return minimaxAvailable;
    case 'mistral':
      return mistralAvailable;
    case 'nvidia':
      return nvidiaAvailable;
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
    case 'deepseek':
      return deepseekModel(spec.model, opts);
    case 'moonshot':
      return moonshotModel(spec.model, opts);
    case 'dashscope':
      return dashscopeModel(spec.model, opts);
    case 'zai':
      return zaiModel(spec.model, opts);
    case 'minimax':
      return minimaxModel(spec.model, opts);
    case 'mistral':
      return mistralModel(spec.model, opts);
    case 'nvidia':
      return nvidiaModel(spec.model, opts);
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
  /** Classification of prompt data; the FACF laptop routes accept only public/synthetic data. */
  dataClass?: 'public' | 'synthetic' | 'internal' | 'confidential' | 'restricted';
  /** Explicitly allow a direct selection to bypass the local budget safety net. */
  bypassBudget?: boolean;
  /** Allow models whose current token price has not been reviewed. */
  allowUnknownPricing?: boolean;
};

export type Router = {
  resolveModel: (alias: string, opts?: ResolveOptions) => { model: LanguageModel; specs: Spec[] };
  listAliases: () => Array<{ alias: string; chain: Spec[]; availableCount: number }>;
};

const DIRECT_RE =
  /^(anthropic|google|google-paid|openai|groq|openrouter|ollama|deepinfra|together|deepseek|moonshot|dashscope|zai|minimax|mistral|nvidia):(.+)$/;

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
    const dataClass = callOpts.dataClass ?? 'internal';
    const facfLaptopRequested =
      alias === 'auto:facf-laptop' || alias === 'auto:laptop-assisted';
    if (facfLaptopRequested && dataClass !== 'public' && dataClass !== 'synthetic') {
      throw new Error('FACF laptop routes accept only dataClass="public" or "synthetic"');
    }
    const direct = alias.match(DIRECT_RE);
    if (direct) {
      const spec: Spec = { provider: direct[1] as Provider, model: direct[2] };
      if (!hasKey(spec.provider) && !perCallKeys?.[spec.provider as keyof PerCallKeys]) {
        throw new Error(`Provider not available: ${spec.provider} (missing API key?)`);
      }
      if (!callOpts.bypassBudget && !withinBudget(spec.provider)) {
        throw new Error(
          `Provider budget unavailable: ${spec.provider}; bypassBudget requires explicit approval`,
        );
      }
      if (!callOpts.allowUnknownPricing && requiresUnknownPricingApproval(spec)) {
        throw new Error(
          `Pricing is not reviewed for ${specLabel(spec)}; set allowUnknownPricing=true`,
        );
      }
      return { model: instantiate(spec, perCallKeys), specs: [spec] };
    }
    const chain = aliases[alias];
    if (!chain) throw new Error(`Unknown model alias: ${alias}`);
    // When per-call keys are supplied, skip the env-pool expansion for
    // `google` — a BYOK key is a single concrete credential, not a pool.
    const availableByKey = chain.filter((s) => isAvailable(s.provider, perCallKeys));
    const filtered = callOpts.allowUnknownPricing
      ? availableByKey
      : availableByKey.filter(hasReviewedAutomaticPricing);
    const available = perCallKeys?.google ? filtered : expandGoogleKeys(filtered);
    if (available.length === 0) {
      if (availableByKey.length > 0 && !callOpts.allowUnknownPricing) {
        throw new Error(
          `No reviewed-price provider for alias ${alias}; set allowUnknownPricing=true`,
        );
      }
      throw new Error(`No available provider for alias ${alias} — set at least one API key`);
    }
    if (available.length === 1 && available[0].provider !== 'ollama') {
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
