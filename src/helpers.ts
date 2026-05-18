/**
 * Convenience wrappers around resolveModel + AI SDK's generateText.
 *
 * Most callers don't want to think about the model object or token
 * accounting — they want `chat({ system, prompt })` → string. These
 * helpers are intentionally thin: they resolve an alias chain, call
 * the AI SDK once, and return the text (or a parsed JSON).
 */
import { generateText as aiGenerateText } from 'ai';
import { resolveModel, type PerCallKeys } from './router';

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
};

export async function chat(req: ChatRequest): Promise<string> {
  const { model } = resolveModel(req.alias ?? 'auto:smart', { perCallKeys: req.perCallKeys });
  const { text } = await aiGenerateText({
    model,
    system: req.system,
    prompt: req.prompt,
    temperature: req.temperature,
    maxOutputTokens: req.maxTokens,
  });
  return text.trim();
}

/**
 * Same as chat() but the LLM is expected to return JSON. Strips
 * ```json fences if present, then JSON.parse. Returns null on parse
 * failure rather than throwing — let the caller decide whether a
 * malformed response is fatal or just an empty result.
 */
export async function chatJson<T = unknown>(req: ChatRequest): Promise<T | null> {
  const raw = await chat(req);
  const cleaned = stripJsonFences(raw);
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

function stripJsonFences(s: string): string {
  const t = s.trim();
  const fenced = t.match(/^```(?:json)?\s*([\s\S]*?)```$/);
  if (fenced) return fenced[1].trim();
  return t;
}
