import type { Provider, Spec } from './types';

export type ModelFamily =
  | 'qwen'
  | 'kimi'
  | 'glm'
  | 'llama'
  | 'minimax'
  | 'mistral'
  | 'gemma'
  | 'nemotron';

export type LicenseClass =
  | 'apache-2.0'
  | 'mit'
  | 'community'
  | 'vendor-terms'
  | 'nvidia-open-model'
  | 'unknown';

export type ModelCapabilities = {
  tools: boolean;
  reasoning: boolean;
  structuredOutput: boolean;
  multimodal: boolean;
  contextTokens: number;
};

export type CatalogEntry = Spec & {
  family: ModelFamily;
  capabilities: ModelCapabilities;
  license: LicenseClass;
  lifecycle: 'current' | 'legacy' | 'preview';
  pricing: 'known' | 'free' | 'unknown';
  source: string;
};

export const MODEL_CATALOG: readonly CatalogEntry[] = [
  { provider: 'dashscope', model: 'qwen3.8-max', family: 'qwen', capabilities: { tools: true, reasoning: true, structuredOutput: true, multimodal: true, contextTokens: 1_000_000 }, license: 'vendor-terms', lifecycle: 'current', pricing: 'unknown', source: 'Alibaba Model Studio' },
  { provider: 'groq', model: 'qwen/qwen3.6-27b', family: 'qwen', capabilities: { tools: true, reasoning: true, structuredOutput: true, multimodal: false, contextTokens: 131_072 }, license: 'apache-2.0', lifecycle: 'current', pricing: 'free', source: 'Groq model catalog' },
  { provider: 'moonshot', model: 'kimi-k3', family: 'kimi', capabilities: { tools: true, reasoning: true, structuredOutput: true, multimodal: false, contextTokens: 1_000_000 }, license: 'vendor-terms', lifecycle: 'current', pricing: 'known', source: 'Moonshot API' },
  { provider: 'zai', model: 'glm-5.3-flash', family: 'glm', capabilities: { tools: true, reasoning: true, structuredOutput: true, multimodal: true, contextTokens: 1_000_000 }, license: 'mit', lifecycle: 'current', pricing: 'known', source: 'Z.ai Models API and pricing page' },
  { provider: 'ollama', model: 'llama4:scout', family: 'llama', capabilities: { tools: true, reasoning: false, structuredOutput: true, multimodal: true, contextTokens: 10_000_000 }, license: 'community', lifecycle: 'current', pricing: 'free', source: 'Meta Llama / Ollama' },
  { provider: 'minimax', model: 'MiniMax-M2.7', family: 'minimax', capabilities: { tools: true, reasoning: true, structuredOutput: false, multimodal: false, contextTokens: 204_800 }, license: 'vendor-terms', lifecycle: 'current', pricing: 'unknown', source: 'MiniMax API' },
  { provider: 'nvidia', model: 'minimaxai/minimax-m2.7', family: 'minimax', capabilities: { tools: true, reasoning: true, structuredOutput: false, multimodal: false, contextTokens: 204_800 }, license: 'vendor-terms', lifecycle: 'current', pricing: 'unknown', source: 'NVIDIA NIM' },
  { provider: 'mistral', model: 'mistral-large-latest', family: 'mistral', capabilities: { tools: true, reasoning: false, structuredOutput: true, multimodal: false, contextTokens: 128_000 }, license: 'vendor-terms', lifecycle: 'current', pricing: 'unknown', source: 'Mistral API' },
  { provider: 'nvidia', model: 'mistralai/mistral-nemotron', family: 'mistral', capabilities: { tools: true, reasoning: true, structuredOutput: true, multimodal: false, contextTokens: 128_000 }, license: 'nvidia-open-model', lifecycle: 'current', pricing: 'unknown', source: 'NVIDIA NIM' },
  { provider: 'ollama', model: 'gemma3:27b', family: 'gemma', capabilities: { tools: false, reasoning: false, structuredOutput: false, multimodal: true, contextTokens: 128_000 }, license: 'vendor-terms', lifecycle: 'current', pricing: 'free', source: 'Google Gemma / Ollama' },
  { provider: 'nvidia', model: 'nvidia/nemotron-3-super-120b-a12b', family: 'nemotron', capabilities: { tools: true, reasoning: true, structuredOutput: true, multimodal: false, contextTokens: 1_000_000 }, license: 'nvidia-open-model', lifecycle: 'current', pricing: 'unknown', source: 'NVIDIA NIM' },
] as const;

export function listCatalog(options: {
  family?: ModelFamily;
  require?: Partial<ModelCapabilities>;
} = {}): CatalogEntry[] {
  return MODEL_CATALOG.filter((entry) => {
    if (options.family && entry.family !== options.family) return false;
    if (!options.require) return true;
    return Object.entries(options.require).every(([key, value]) => {
      const actual = entry.capabilities[key as keyof ModelCapabilities];
      return typeof value === 'number' ? Number(actual) >= value : actual === value;
    });
  }).map((entry) => ({ ...entry, capabilities: { ...entry.capabilities } }));
}

export function hasReviewedAutomaticPricing(spec: Spec): boolean {
  const entry = MODEL_CATALOG.find(
    (candidate) => candidate.provider === spec.provider && candidate.model === spec.model,
  );
  return !entry || entry.pricing !== 'unknown';
}

export function requiresUnknownPricingApproval(spec: Spec): boolean {
  const entry = MODEL_CATALOG.find(
    (candidate) => candidate.provider === spec.provider && candidate.model === spec.model,
  );
  const catalogProviders: Provider[] = ['dashscope', 'zai', 'minimax', 'mistral', 'nvidia'];
  return entry?.pricing === 'unknown' || (!entry && catalogProviders.includes(spec.provider));
}
