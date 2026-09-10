import type { Spec } from './types';

/**
 * Default fallback chains. Cost-first wherever quality allows: free /
 * local providers lead, paid cloud providers serve as fallbacks. Override
 * per-service via createRouter({ aliases }).
 *
 * Cost reference (input / output per M tokens, May 2026):
 *   ollama:*                         free (compute on dev / local box)
 *   groq:qwen3.6-27b                 free (rate-limited)
 *   openrouter:*:free                free (small daily cap per account)
 *   google:gemini-2.5-flash          free tier — 1500 RPD per GCP project
 *   deepinfra:llama-3.1-8b           $0.04 / $0.04   (ultra-cheap tier)
 *   deepseek:deepseek-v4-flash       $0.14 / $0.28   (reasoning model — thinks by default)
 *   deepseek:deepseek-v4-pro         $0.435 / $0.87  (top reasoning/quality)
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
//
// **DeepSeek V4 Flash/Pro think by default** (chain-of-thought, verified
// 2026-05-27 against api.deepseek.com). They are placed only in chains
// where reasoning earns its latency + output-token cost — auto:smart,
// auto:code, auto:big, auto:reasoning — and deliberately kept OUT of
// auto:fast / auto:translate / auto:cheap (classification, transforms,
// strict cost), where CoT is pure overhead. Non-thinking mode requires
// `thinking: { type: 'disabled' }` in the request body, which a plain
// chain Spec can't express; for cheap non-thinking DeepSeek use the
// explicit `deepseek:deepseek-chat` id (non-thinking, but deprecated
// 2026-07-24) or call generateText directly with providerOptions.
export const DEFAULT_ALIASES: Record<string, Spec[]> = {
  // Chat / generic. DeepSeek V4 Flash leads for reliability (see comment
  // above); everything after it is price-ordered ascending ($/M input+output),
  // treating prices within $0.25/M of each other as a tie and keeping the
  // prior curated order there so a marginally cheaper generalist model can't
  // bump a task-suited specialist (e.g. GLM stays ahead of plain Llama-3.3-70B).
  'auto:smart': [
    { provider: 'deepseek', model: 'deepseek-v4-flash' },
    { provider: 'google', model: 'gemini-2.5-flash' },
    { provider: 'google', model: 'gemini-2.5-pro' },
    { provider: 'google-paid', model: 'gemini-2.5-flash' },
    { provider: 'zai', model: 'glm-5.3-flash' },
    { provider: 'deepinfra', model: 'meta-llama/Meta-Llama-3.3-70B-Instruct' },
    { provider: 'together', model: 'meta-llama/Llama-3.3-70B-Instruct-Lite' },
    { provider: 'deepseek', model: 'deepseek-v4-pro' },
    { provider: 'zai', model: 'glm-5.3' },
    { provider: 'google-paid', model: 'gemini-2.5-pro' },
    { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    { provider: 'openai', model: 'gpt-5' },
    { provider: 'moonshot', model: 'kimi-k3' },
  ],
  // Classification, language detection, short tasks.
  'auto:fast': [
    { provider: 'groq', model: 'qwen/qwen3.6-27b' },
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
  // Code generation / completion. Price-ordered after DeepSeek V4 Flash,
  // same $0.25/M tie rule as auto:smart above.
  'auto:code': [
    { provider: 'deepseek', model: 'deepseek-v4-flash' },
    { provider: 'google', model: 'gemini-2.5-flash' },
    { provider: 'groq', model: 'qwen/qwen3.6-27b' },
    { provider: 'google-paid', model: 'gemini-2.5-flash' },
    { provider: 'zai', model: 'glm-5.3-flash' },
    { provider: 'deepinfra', model: 'meta-llama/Meta-Llama-3.3-70B-Instruct' },
    { provider: 'openai', model: 'gpt-5-mini' },
    { provider: 'zai', model: 'glm-5.3' },
  ],
  // Reasoning / planning / multi-step. Price-ordered after DeepSeek V4 Flash,
  // same $0.25/M tie rule as auto:smart above.
  'auto:reasoning': [
    { provider: 'deepseek', model: 'deepseek-v4-flash' },
    { provider: 'google', model: 'gemini-2.5-pro' },
    { provider: 'zai', model: 'glm-5.3-flash' },
    { provider: 'deepseek', model: 'deepseek-v4-pro' },
    { provider: 'deepinfra', model: 'deepseek-ai/DeepSeek-V3' },
    { provider: 'zai', model: 'glm-5.3' },
    { provider: 'google-paid', model: 'gemini-2.5-pro' },
    { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    { provider: 'openai', model: 'gpt-5' },
    { provider: 'moonshot', model: 'kimi-k3' },
  ],
  // Explicit paid only — for tasks where top quality is needed and budget approved.
  'auto:paid': [
    { provider: 'openai', model: 'gpt-5' },
    { provider: 'openai', model: 'gpt-5-mini' },
    { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    { provider: 'google-paid', model: 'gemini-2.5-pro' },
    { provider: 'moonshot', model: 'kimi-k3' },
  ],
  // Large-context tasks (long docs, big diffs). Price-ordered after
  // DeepSeek V4 Flash, same $0.25/M tie rule as auto:smart above.
  'auto:big': [
    { provider: 'deepseek', model: 'deepseek-v4-flash' },
    { provider: 'google', model: 'gemini-2.5-pro' },
    { provider: 'zai', model: 'glm-5.3-flash' },
    { provider: 'deepinfra', model: 'meta-llama/Meta-Llama-3.3-70B-Instruct' },
    { provider: 'zai', model: 'glm-5.3' },
    { provider: 'google-paid', model: 'gemini-2.5-pro' },
    { provider: 'openai', model: 'gpt-5' },
    { provider: 'moonshot', model: 'kimi-k3' },
  ],
  // Local-only — for fully offline / air-gapped paths. Opt-in: callers must
  // explicitly select this alias. Not safe as a default fallback because
  // CPU-only hosts (current dev/hub fleet) miss the 60 s timeout.
  'auto:local': [
    { provider: 'ollama', model: 'qwen2.5:14b' },
    { provider: 'ollama', model: 'gemma4:e2b' },
  ],
  // Opportunistic laptop GPU. Explicit opt-in so an intermittent worker never
  // adds health-check latency to existing production aliases.
  'auto:laptop-assisted': [
    { provider: 'ollama', model: 'qwen2.5:7b' },
    { provider: 'google', model: 'gemini-2.5-flash' },
    { provider: 'deepinfra', model: 'meta-llama/Meta-Llama-3.1-8B-Instruct' },
    { provider: 'google-paid', model: 'gemini-2.5-flash' },
  ],
  // FACF Phase 0 bridge: a private, opportunistic laptop worker with cloud
  // fallback. The resolver permits this route only for public/synthetic data.
  'auto:facf-laptop': [
    { provider: 'ollama', model: 'qwen2.5:7b' },
    { provider: 'google', model: 'gemini-2.5-flash' },
    { provider: 'deepinfra', model: 'meta-llama/Meta-Llama-3.1-8B-Instruct' },
    { provider: 'google-paid', model: 'gemini-2.5-flash' },
  ],
  // Cost-first: free + ultra-cheap providers; expensive tiers excluded.
  // Excludes ollama (unreliable on CPU hosts) and openrouter:free (prose).
  'auto:cheap': [
    { provider: 'groq', model: 'qwen/qwen3.6-27b' },
    { provider: 'google', model: 'gemini-2.5-flash' },
    { provider: 'deepinfra', model: 'meta-llama/Meta-Llama-3.1-8B-Instruct' },
    { provider: 'deepinfra', model: 'meta-llama/Meta-Llama-3.3-70B-Instruct' },
    { provider: 'google-paid', model: 'gemini-2.5-flash' },
  ],
  // Kimi K3 direct-only alias. No longer gated: Moonshot is now natively
  // OpenAI/Anthropic-protocol compatible and ships in the top-tier default
  // chains above (auto:smart/reasoning/paid/big); this alias remains for
  // callers who want Kimi K3 specifically without the rest of the chain.
  'auto:kimi-pilot': [
    { provider: 'moonshot', model: 'kimi-k3' },
  ],
  // Explicit GLM Flash pilot; never selected by an existing default alias.
  'auto:glm-flash-pilot': [
    { provider: 'zai', model: 'glm-5.3-flash' },
  ],
  'family:qwen': [
    { provider: 'groq', model: 'qwen/qwen3.6-27b' },
    { provider: 'dashscope', model: 'qwen3.8-max' },
  ],
  'family:kimi': [{ provider: 'moonshot', model: 'kimi-k3' }],
  'family:glm': [{ provider: 'zai', model: 'glm-5.3-flash' }, { provider: 'zai', model: 'glm-5.3' }],
  'family:llama': [{ provider: 'ollama', model: 'llama4:scout' }],
  'family:minimax': [
    { provider: 'minimax', model: 'MiniMax-M2.7' },
    { provider: 'nvidia', model: 'minimaxai/minimax-m2.7' },
  ],
  'family:mistral': [
    { provider: 'mistral', model: 'mistral-large-latest' },
    { provider: 'nvidia', model: 'mistralai/mistral-nemotron' },
  ],
  'family:gemma': [{ provider: 'ollama', model: 'gemma3:27b' }],
  'family:nemotron': [
    { provider: 'nvidia', model: 'nvidia/nemotron-3-super-120b-a12b' },
  ],
};
