/**
 * Optional TypeSafe "Jev" second opinion for automatic routing.
 *
 * Jev is a System One model: it returns typed decisions with calibrated
 * probabilities instead of generated text. We consult it ONLY for the one
 * ambiguous case the deterministic classifier cannot resolve on its own —
 * the auto:facf-laptop fallback for public/synthetic data. The feature is
 * off by default and every failure mode degrades to current behaviour.
 */

import type { AutomaticRoutingInput } from './automatic-routing';

const DEFAULT_URL = 'https://api.typesafe.ai/v1/systemone';
const DEFAULT_MODEL = 'jev-latest';
const MAX_STATE_CHARS = 8_000;
const MAX_CACHE_ENTRIES = 200;
// Minimum probability for an accepted route and the risk-probability cutoff; both deliberately conservative so the second opinion can only add capability.
const CHOICE_MIN_PROBABILITY = 0.6;
const HIGH_RISK_THRESHOLD = 0.5;

const ALLOWED_ALIASES = [
  'auto:facf-laptop',
  'auto:code',
  'auto:smart',
  'auto:reasoning',
] as const;

// Mirrors the small clamp helper in src/ollama-gate.ts, but reads from the
// supplied environment so per-call config is honoured.
const intEnv = (env: NodeJS.ProcessEnv, name: string, fallback: number, min: number): number => {
  const parsed = Number.parseInt(env[name] ?? '', 10);
  return Number.isFinite(parsed) ? Math.max(min, parsed) : fallback;
};

export type JevClassifyResult =
  | { alias: string; confidence: number; highRisk: boolean }
  | null;

const QUESTIONS = {
  route: {
    type: 'choice',
    instructions: 'Which model route should handle this request?',
    criteria: {
      'auto:facf-laptop': 'very short, simple, non-code, non-analytical public text work',
      'auto:code': 'writing, changing, debugging or explaining code',
      'auto:smart': 'general writing or answering that needs a capable general model',
      'auto:reasoning': 'multi-step analysis, planning, evaluation or a high-stakes judgement',
    },
  },
  high_risk: {
    type: 'noul',
    instructions:
      'Does this request involve legal, tax, accounting, medical, security, credential, production, migration or deletion decisions?',
  },
} as const;

type JevResponse = {
  answers?: {
    route?: { choice?: unknown; probabilities?: Record<string, unknown> };
    high_risk?: { noul?: unknown };
  };
};

// Keyed by the exact truncated state text; holds only successful, accepted
// classifications. Failures and low-confidence answers are deliberately not
// cached, so one transient error cannot permanently disable the feature for a
// state. Eviction is FIFO by insertion order, not LRU.
const cache = new Map<string, JevClassifyResult>();

export function jevRoutingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = (env.CCO_ROUTER_JEV ?? '').trim().toLowerCase();
  const key = env.TYPESAFE_API_KEY;
  return (flag === '1' || flag === 'true' || flag === 'yes') && typeof key === 'string' && key.length > 0;
}

const stateText = (input: AutomaticRoutingInput): string =>
  `${input.system ?? ''}\n${input.prompt}`.slice(0, MAX_STATE_CHARS);

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

function interpret(body: JevResponse): JevClassifyResult {
  const answers = body?.answers;
  const noul = asNumber(answers?.high_risk?.noul);
  if (noul !== null && noul >= HIGH_RISK_THRESHOLD) {
    return { alias: 'auto:reasoning', confidence: noul, highRisk: true };
  }

  const choice = answers?.route?.choice;
  if (typeof choice !== 'string' || !(ALLOWED_ALIASES as readonly string[]).includes(choice)) {
    return null;
  }
  const probability = asNumber(answers?.route?.probabilities?.[choice]);
  if (probability === null || probability < CHOICE_MIN_PROBABILITY) return null;
  return { alias: choice, confidence: probability, highRisk: false };
}

async function requestJev(
  state: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
): Promise<JevClassifyResult> {
  const url = env.TYPESAFE_API_URL ?? DEFAULT_URL;
  const key = env.TYPESAFE_API_KEY ?? '';
  const model = env.TYPESAFE_MODEL ?? DEFAULT_MODEL;
  const timeoutMs = intEnv(env, 'CCO_LLM_JEV_TIMEOUT_MS', 1_500, 100);

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ state, model, questions: QUESTIONS }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as JevResponse;
    return interpret(body);
  } catch {
    return null;
  }
}

function remember(state: string, result: JevClassifyResult): void {
  cache.set(state, result);
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

/**
 * Ask Jev for a routing decision. Never throws; returns null on any error,
 * timeout, non-2xx status, or unparseable/implausible answer.
 */
export async function classifyWithJev(
  input: AutomaticRoutingInput,
  opts?: { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv },
): Promise<JevClassifyResult> {
  const env = opts?.env ?? process.env;

  // This exported entry point bypasses the deterministic classifier's data
  // isolation, so it enforces the same public/synthetic-only rule itself
  // (undefined is treated as internal). The refusal returns before the cache
  // lookup and before any request, because the cache is keyed by state text
  // alone: a refusal must never shadow a later allowed call.
  if (input.dataClass !== 'public' && input.dataClass !== 'synthetic') return null;

  const state = stateText(input);
  if (cache.has(state)) return cache.get(state) ?? null;

  const result = await requestJev(state, env, opts?.fetchImpl ?? fetch);
  if (result) remember(state, result);
  return result;
}

/** Test-only reset; intentionally not exported from the package entrypoint. */
export function __clearJevCache(): void {
  cache.clear();
}
