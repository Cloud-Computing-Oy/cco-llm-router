# DeepSeek V4 provider for cco-llm-router

**Date:** 2026-05-27
**Status:** Design — awaiting review
**Branch:** `feat/deepseek-v4-provider`

## Goal

Add DeepSeek V4 as a first-class native provider in `@cloud-computing-oy/llm-router`,
and make it a **default** workhorse across the shared fallback chains so every CCO
service that calls `resolveModel('auto:*')` uses DeepSeek "wherever it makes sense
considering price and quality" — without per-service code changes.

DeepSeek V4 Flash is frontier-class quality at $0.14 / $0.28 per 1M tokens (in / out),
cheaper than every paid entry currently in the chains except the free tiers. That is
the value proposition: use it often, it's cheap.

## Decisions (locked with user)

1. **Native provider**, not OpenRouter routing. Reads `DEEPSEEK_API_KEY`, base URL
   `https://api.deepseek.com`, OpenAI-compatible. No native key exists in the fleet
   yet; the provider stays dormant (filtered out of every chain) until the key is
   added to `/etc/cco/keys.env`, so this change is behavior-neutral until then.
2. **Explicit V4 model IDs**, not the `deepseek-chat` / `deepseek-reasoner` aliases —
   those legacy aliases retire 2026-07-24. Use `deepseek-v4-flash` and
   `deepseek-v4-pro`.
3. **Free-first ordering kept.** $0 Google/Groq tiers stay ahead of DeepSeek (price
   wins, quality comparable). DeepSeek **Flash leads the paid tier**; **Pro** sits in
   the quality tier of `auto:smart` / `auto:reasoning`.
4. **Rollout** (publish + consumer bumps) is a follow-up phase gated on explicit
   go-ahead. The Python router (`cco-llm-router-py`, used by AgentX) is out of scope
   for this spec — separate repo, separate follow-up.

## Verified facts (DeepSeek official docs, May 2026)

- Base URL `https://api.deepseek.com`, OpenAI-compatible format.
- `deepseek-v4-flash`: input (cache miss) $0.14/M, output $0.28/M. 1M-token context.
- `deepseek-v4-pro`: input (cache miss) $0.435/M, output $0.87/M (75%-off promo
  through 2026-05-31 15:59 UTC; revisit after). 1M-token context.
- Cache-hit input is ~50–120× cheaper but the router's usage tracker has **no
  cache-hit accounting** (it only sees input/output token counts), so we price at
  cache-*miss*. This conservatively over-estimates spend — safe for the budget net.

## Architecture

One new provider module, identical in shape to `deepinfra.ts` / `together.ts`:

```ts
// src/providers/deepseek.ts
import { createOpenAI } from '@ai-sdk/openai';

const envKey = process.env.DEEPSEEK_API_KEY;
const BASE = 'https://api.deepseek.com';

export const deepseekAvailable = Boolean(envKey);

const envProvider = envKey ? createOpenAI({ apiKey: envKey, baseURL: BASE }) : null;

export function deepseekModel(name: string, opts?: { apiKey?: string }) {
  if (opts?.apiKey) {
    return createOpenAI({ apiKey: opts.apiKey, baseURL: BASE })(name);
  }
  if (!envProvider) throw new Error('DEEPSEEK_API_KEY not set');
  return envProvider(name);
}
```

This is a self-contained unit: input is a model name (+ optional per-call key),
output is an AI SDK `LanguageModel`. It depends only on `@ai-sdk/openai` and the env
var. It cannot break any other provider.

## Wiring (TypeScript exhaustiveness forces each edit)

Adding `'deepseek'` to the `Provider` union makes `tsc --noEmit` fail until every
exhaustive switch and `Record<Provider, …>` is updated — that is the safety net that
guarantees nothing is missed.

| File | Change |
|------|--------|
| `src/types.ts` | Add `'deepseek'` to the `Provider` union. |
| `src/providers/deepseek.ts` | New file (above). |
| `src/router.ts` | Import `deepseekAvailable` / `deepseekModel`; add `case 'deepseek'` to `hasKey` and `instantiate`; add `deepseek` to the `DIRECT_RE` regex. |
| `src/budget.ts` | Add `deepseek: 'CCO_LLM_BUDGET_DEEPSEEK_USD'` to `ENV_KEY`. |
| `src/pricing.ts` | Add `deepseek:deepseek-v4-flash` = {0.14, 0.28} and `deepseek:deepseek-v4-pro` = {0.435, 0.87}, with the promo-end comment. |
| `src/index.ts` | Export `deepseekAvailable`, `deepseekModel`. |
| `README.md` | Provider-availability table row (`deepseek` / `DEEPSEEK_API_KEY`); add `CCO_LLM_BUDGET_DEEPSEEK_USD` to the budget section; mention DeepSeek in the top description. |
| `package.json` | Version `0.9.0` → `0.10.0` (minor: new provider). |

`PerCallKeys` already covers `deepseek` automatically (it excludes only `'ollama'`),
so BYOK per-call overrides work with no extra change.

## Chain placement (`DEFAULT_ALIASES` in `src/router.ts`)

`+` marks an inserted DeepSeek entry. Free $0 tiers stay first; Flash leads the paid
tier; Pro is the cheap quality step.

- **`auto:smart`**: google flash → **+ deepseek-v4-flash** → deepinfra-70b →
  google-paid flash → together-lite → google pro → **+ deepseek-v4-pro** →
  google-paid pro → anthropic sonnet → openai gpt-5
- **`auto:fast`**: groq → google flash → **+ deepseek-v4-flash** → deepinfra-8b →
  google-paid flash → openai mini → anthropic haiku
- **`auto:translate`**: google flash → **+ deepseek-v4-flash** → deepinfra-70b →
  google-paid flash → anthropic sonnet
- **`auto:code`**: google flash → groq → **+ deepseek-v4-flash** → deepinfra-70b →
  google-paid flash → openai mini
- **`auto:reasoning`**: google pro → **+ deepseek-v4-pro** → deepinfra DeepSeek-V3 →
  google-paid pro → anthropic sonnet → openai gpt-5
- **`auto:big`**: google pro → **+ deepseek-v4-flash** (1M ctx) → deepinfra-70b →
  google-paid pro → openai gpt-5
- **`auto:cheap`**: groq → google flash → **+ deepseek-v4-flash** → deepinfra-8b →
  deepinfra-70b → google-paid flash
- **`auto:paid`**, **`auto:local`**: unchanged. (`auto:paid` is for "spare-no-expense"
  top quality; DeepSeek is cheap, not premium-top, so it stays out.)

## Error handling / safety

- No `DEEPSEEK_API_KEY` → `deepseekAvailable === false` → router filters every
  `deepseek` spec out of the chain (`isAvailable`), so chains fall through exactly as
  today. **Zero behavioral change until the key is set.**
- Budget net: `CCO_LLM_BUDGET_DEEPSEEK_USD` works like every other provider; unset =
  unrestricted at the router (dashboard cap is the real control).
- Direct calls `resolveModel('deepseek:deepseek-v4-flash')` work via `DIRECT_RE` and
  bypass budget (caller asked for it explicitly), consistent with other providers.

## Verification

- `npm run typecheck` (`tsc --noEmit`) — the only test script. Exhaustive switches +
  `Record<Provider,…>` catch any missed wiring at compile time.
- Live smoke test (optional, needs a real key): set `DEEPSEEK_API_KEY` locally and run
  a one-off `resolveModel('deepseek:deepseek-v4-flash')` + `chat()` round-trip.

## Out of scope (follow-up phases, gated on explicit go-ahead)

1. **Publish `0.10.0`** to GitHub Packages (`gh auth refresh -s write:packages` +
   `NPM_TOKEN=$(gh auth token) npm publish`).
2. **Bump TS consumers** to `0.10.0` (verify the actual current consumer set at
   execution time — MIGRATION.md is stale re: LexAI/Invoicify) and redeploy each.
3. **`cco-llm-router-py`** DeepSeek support for AgentX — separate spec.
