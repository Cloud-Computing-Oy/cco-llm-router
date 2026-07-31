/**
 * Defensive char-cap for prompt bodies before they reach the LLM.
 *
 * Why this exists: real-world documents (PDF extracts, OCR output, .docx
 * dumps) routinely exceed model context windows in unexpected ways. A 8.5 MB
 * English RFP extracted to 516k chars / 158k tokens, exceeding GPT-4o-mini's
 * 128k context and crashing the parser with HTTP 400 context_length_exceeded.
 *
 * The cap is intentionally model-agnostic and conservative: it sits below
 * the smallest context window in our default fallback chains (128k tokens,
 * llama-3.3-70b / claude-haiku / openai gpt-5-mini). Head is preserved
 * because RFQ/contract/document head usually contains the structured fields
 * a parser needs (parties, dates, requirements).
 *
 * The 3.5 chars/token heuristic holds for mixed Finnish + English; CJK runs
 * closer to 1 char/token and benefits from a lower cap if a consumer knows
 * its corpus is CJK-heavy (pass `maxChars` explicitly).
 */

/** Default character cap for prompt bodies. ~120k tokens at 3.5 chars/token,
 *  leaving ~8k headroom for system prompt + completion in a 128k-token model. */
export const DEFAULT_MAX_PROMPT_CHARS = 380_000;

const TRUNCATION_MARKER =
  '\n\n[... document truncated at router due to length; tail not analyzed ...]';

/**
 * Truncate `text` to fit within `maxChars`, preserving the head of the
 * document and appending a clear marker so the LLM knows the tail is missing.
 *
 * Returns the original string when it already fits — no copy, no marker.
 *
 * @param text     Input text (typically a prompt body or extracted document).
 * @param maxChars Maximum character count. Defaults to DEFAULT_MAX_PROMPT_CHARS.
 *                 Pass `Infinity` or a value larger than `text.length` to disable.
 */
export function truncateForLlm(
  text: string,
  maxChars: number = DEFAULT_MAX_PROMPT_CHARS,
): string {
  if (!Number.isFinite(maxChars) || text.length <= maxChars) {
    return text;
  }
  const budget = maxChars - TRUNCATION_MARKER.length;
  if (budget <= 0) {
    // Degenerate input: caller passed a cap smaller than the marker itself.
    // Return the marker alone — caller almost certainly intended this as a
    // hard limit and would prefer a tiny stub over a silently mangled prompt.
    return TRUNCATION_MARKER.trimStart();
  }
  return text.slice(0, budget) + TRUNCATION_MARKER;
}

/**
 * Same as truncateForLlm but emits a console.warn when truncation kicks in,
 * with original/truncated sizes. Used by helpers.ts auto-truncation so a
 * caller who didn't think about caps still sees a signal in their logs.
 */
export function truncateForLlmWithWarning(
  text: string,
  maxChars: number = DEFAULT_MAX_PROMPT_CHARS,
  label = 'prompt',
): string {
  const out = truncateForLlm(text, maxChars);
  if (out.length < text.length) {
    console.warn(
      `[llm-router] ${label} truncated for LLM: ${text.length} → ${out.length} chars (cap=${maxChars})`,
    );
  }
  return out;
}
