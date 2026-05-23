/**
 * Convenience wrappers around resolveModel + AI SDK's generateText /
 * generateObject.
 *
 * Most callers don't want to think about the model object or token
 * accounting — they want `chat({ system, prompt })` → string, or
 * `chatJsonStrict({ schema, prompt })` → typed object. These helpers
 * are intentionally thin: they resolve an alias chain, call the AI
 * SDK once (with a default 60 s abort timeout), and return.
 */
import { generateText as aiGenerateText, generateObject as aiGenerateObject } from 'ai';
import type { z } from 'zod';
import { resolveModel, type PerCallKeys } from './router';
import { DEFAULT_MAX_PROMPT_CHARS, truncateForLlmWithWarning } from './truncate';

/** Default per-call abort timeout. Without this an unresponsive
 *  provider can hang the request indefinitely (observed 2026-05-22
 *  with Google Gemini Flash paid in LexAI). */
export const DEFAULT_CALL_TIMEOUT_MS = 60_000;

export type ChatRequest = {
  /** Alias from the router (auto:smart, auto:fast, auto:translate, …).
   *  Defaults to 'auto:smart'. */
  alias?: string;
  system: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  /** Per-call API key overrides for BYOK consumers. See resolveModel docs. */
  perCallKeys?: PerCallKeys;
  /** Overall abort signal. Defaults to AbortSignal.timeout(DEFAULT_CALL_TIMEOUT_MS). */
  abortSignal?: AbortSignal;
  /**
   * Maximum characters for `prompt` before sending to the model. Defaults to
   * DEFAULT_MAX_PROMPT_CHARS (380k chars ≈ 120k tokens) — sized for the
   * smallest context in our default fallback chains. When the cap kicks in,
   * the head of the prompt is preserved and a truncation marker is appended.
   * Pass `Infinity` to disable. The `system` field is never truncated.
   */
  maxPromptChars?: number;
};

function applyPromptCap(req: ChatRequest): string {
  return truncateForLlmWithWarning(
    req.prompt,
    req.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS,
    req.alias ?? 'auto:smart',
  );
}

export async function chat(req: ChatRequest): Promise<string> {
  const { model } = resolveModel(req.alias ?? 'auto:smart', { perCallKeys: req.perCallKeys });
  const { text } = await aiGenerateText({
    model,
    system: req.system,
    prompt: applyPromptCap(req),
    temperature: req.temperature,
    maxOutputTokens: req.maxTokens,
    abortSignal: req.abortSignal ?? AbortSignal.timeout(DEFAULT_CALL_TIMEOUT_MS),
  });
  return text.trim();
}

/**
 * Same as chat() but the LLM is expected to return JSON. Strips
 * ```json fences and falls back to first-`{` … last-`}` slice if the
 * model wraps the JSON in prose. Returns null on parse failure rather
 * than throwing — see chatJsonStrict for the throwing/typed variant.
 *
 * Note: this does NOT retry the chain on parse failure — AI SDK's
 * `fallback` model already exhausted the chain at the model layer. If
 * you need schema-enforced output use chatJsonStrict.
 */
export async function chatJson<T = unknown>(req: ChatRequest): Promise<T | null> {
  const raw = await chat(req);
  const cleaned = extractJson(raw);
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

/**
 * Strict JSON generation using AI SDK's `generateObject`, which forces
 * the provider to emit structured output that matches the schema
 * (uses OpenAI strict mode / Google responseSchema / Anthropic tool
 * use under the hood). Eliminates the markdown-fence-in-JSON.parse
 * failure mode entirely.
 *
 * Throws on schema-validation failure or if every provider in the
 * fallback chain rejects the request.
 */
export async function chatJsonStrict<T>(req: ChatRequest & { schema: z.ZodSchema<T> }): Promise<T> {
  const { model } = resolveModel(req.alias ?? 'auto:smart', { perCallKeys: req.perCallKeys });
  const { object } = await aiGenerateObject({
    model,
    schema: req.schema,
    system: req.system,
    prompt: applyPromptCap(req),
    temperature: req.temperature,
    maxOutputTokens: req.maxTokens,
    abortSignal: req.abortSignal ?? AbortSignal.timeout(DEFAULT_CALL_TIMEOUT_MS),
  });
  return object;
}

/** Extract a JSON object from an LLM response. Strips ```json fences
 *  and falls back to the first `{...}` block if the response is
 *  wrapped in prose. Exported so consumers can re-use the same
 *  extraction logic for their own JSON.parse sites. */
export function extractJson(raw: string): string {
  const s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last > first) return s.slice(first, last + 1).trim();
  return s;
}
