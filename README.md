# @cloud-computing-oy/llm-router

Shared LLM router for Cloud-Computing-Oy services. Provider-fallback
chains over Anthropic / Google / DeepSeek / Moonshot / OpenAI / Groq / OpenRouter /
Ollama / DeepInfra / Together, plus a Cohere rerank helper and
per-provider monthly budget enforcement.

Reads API keys from `process.env` at runtime. On the CCO prod / dev
hosts, these come from `/etc/cco/keys.env` (pulled in by every service's
docker-compose `env_file:`).

## Repo layout

This repo carries both language bindings of the router:

- **Root (TypeScript / Node)** — published to GitHub Packages as
  `@cloud-computing-oy/llm-router`. The Next.js / TypeScript services
  (Invoicify, LexAI, expat-aivozone, cc-code) depend on this.
- **[`py/`](./py)** — Python sibling, published to PyPI / consumed
  via `pip` by the Python services (was previously the standalone repo
  `Cloud-Computing-Oy/cco-llm-router-py`, merged here with history).

Each subdirectory owns its own packaging (`package.json` for TS at root,
`pyproject.toml` under `py/`). The default alias chains in
`src/router.ts` and `py/cco_llm_router/router.py` should stay in sync
when adding new providers or shifting model defaults.

## Install

The package is private — consume via git+ssh:

```json
{
  "dependencies": {
    "@cloud-computing-oy/llm-router": "git+ssh://git@github.com:Cloud-Computing-Oy/cco-llm-router.git#main"
  }
}
```

Pin to a tag for production stability:

```json
"@cloud-computing-oy/llm-router": "git+ssh://git@github.com:Cloud-Computing-Oy/cco-llm-router.git#v0.1.0"
```

## Usage

```ts
import { resolveModel } from '@cloud-computing-oy/llm-router';
import { generateText } from 'ai';

const { model } = resolveModel('auto:smart');
const { text } = await generateText({ model, prompt: 'hello' });
```

Available default aliases — strict cost-first: own-server Ollama leads,
then free cloud tiers, then ultra-cheap DeepInfra/Together buffer, then
Google paid / Anthropic / OpenAI as fallbacks:

| Alias | Use case | Chain (cost-first) |
|-------|----------|--------------------|
| `auto:smart` | Chat, generic | ollama → google-free → openrouter-free → **deepinfra-70b** → google-paid → together → anthropic → openai |
| `auto:fast` | Classification, short tasks | ollama-e2b → groq-free → google-free → openrouter-free → **deepinfra-8b** → google-paid → openai-mini |
| `auto:translate` | Batch translation | ollama → google-free → **deepinfra-70b** → google-paid → anthropic |
| `auto:code` | Code generation | ollama → google-free → openrouter-free → groq-free → **deepinfra-70b** → google-paid → openai-mini |
| `auto:reasoning` | Planning, multi-step (cloud-first — no thinking-grade local) | google-free-pro → openrouter-free → **deepinfra-deepseek-v3** → google-paid-pro → anthropic → openai → ollama |
| `auto:big` | Long context | ollama-26b → openrouter-free → google-free-pro → **deepinfra-70b** → google-paid-pro → openai |
| `auto:cheap` | Cost-first, strict | ollama → openrouter-free → groq-free → google-free → **deepinfra-8b** → **deepinfra-70b** → google-paid-flash |
| `auto:paid` | Top quality, opt-in | openai → anthropic → google-paid-pro |
| `auto:local` | Air-gapped | ollama only |
| `auto:kimi-pilot` | Explicit Kimi K3 pilot | moonshot:kimi-k3 only |

Ollama specs are no-op on hosts without `OLLAMA_BASE_URL` set — the router
skips unavailable providers. On hosts where the URL is set but the
server is down, the fallback walks past it after the immediate
connection refusal. There is no active health check; the fallback layer
handles outages by transparently moving to the next slot.

You can also call a provider directly without going through the fallback
chain (useful when you genuinely need a specific model and don't want
quiet degradation):

```ts
const { model } = resolveModel('anthropic:claude-sonnet-4-6');
```

### Kimi K3 pilot

Kimi K3 is intentionally opt-in and is not present in any existing default
fallback chain. Configure a Kimi Platform key and select the pilot alias:

```bash
MOONSHOT_API_KEY=sk-...
MOONSHOT_BASE_URL=https://api.moonshot.ai/v1 # optional override
CCO_LLM_BUDGET_MOONSHOT_USD=20
```

```ts
const { model } = resolveModel('auto:kimi-pilot');
// Equivalent direct selection: moonshot:kimi-k3
```

Use Kimi Platform credentials for product and team integrations. Kimi Code
membership credentials are intended for personal coding workflows. Do not
enable the pilot for customer, legal, invoice, or other confidential data
until the data-processing terms and transfer basis have been approved.

The router records K3 at the conservative cache-miss price ($3 input / $15
output per million tokens). Cache-hit discounts are not subtracted by the
local usage tracker, so the budget guard errs on the safe side.

### Custom aliases

```ts
import { createRouter } from '@cloud-computing-oy/llm-router';

const router = createRouter({
  aliases: {
    'my-service:summarise': [
      { provider: 'google', model: 'gemini-2.5-flash' },
      { provider: 'ollama', model: 'gemma4:26b' },
    ],
  },
});
const { model } = router.resolveModel('my-service:summarise');
```

### Prompt-size cap

Every `chat`, `chatJson`, and `chatJsonStrict` call truncates `prompt` to
`DEFAULT_MAX_PROMPT_CHARS` (380k chars ≈ 120k tokens — sized for the
smallest context in our default fallback chains). The head of the prompt
is preserved; a clear marker is appended; a `console.warn` records the
original/truncated sizes. The `system` field is never truncated.

```ts
import { chat } from '@cloud-computing-oy/llm-router';

// Default cap (380k chars) — applied automatically.
await chat({ system: 'You are a summariser.', prompt: hugePdfText });

// Tighten the cap for a 32k-token local model.
await chat({ alias: 'auto:local', system: '…', prompt: text, maxPromptChars: 95_000 });

// Opt out (e.g. for million-token Gemini Pro with structured outputs).
await chat({ alias: 'google:gemini-2.5-pro', system: '…', prompt: text, maxPromptChars: Infinity });
```

For prompts assembled from multiple fields where a head-preserving cap
would drop critical tail content (e.g. JSON-schema instructions at the
end of the prompt), call `truncateForLlm(field, cap)` on the unbounded
field before concatenation and pass the result into the prompt template.

```ts
import { truncateForLlm } from '@cloud-computing-oy/llm-router';

const prompt = `Analyse:\n${truncateForLlm(documentText, 300_000)}\n\nReturn JSON.`;
```

### Cohere rerank

```ts
import { rerank } from '@cloud-computing-oy/llm-router/cohere';

const ranked = await rerank({
  query: 'family reunification visa for non-EU spouse',
  documents: chunks.map((c) => c.text),
  topN: 5,
});
// ranked is [{ index, relevanceScore }, ...] sorted by score desc
```

## Provider availability

A provider is considered available iff its env var is set:

| Provider | Env var |
|----------|---------|
| anthropic | `ANTHROPIC_API_KEY` |
| google (free pool) | `GOOGLE_GENERATIVE_AI_API_KEY` (or `GOOGLE_GENAI_API_KEY` / `GEMINI_API_KEY`) for the primary slot, then `GOOGLE_GENERATIVE_AI_API_KEY_2`, `_3`, … for extra slots — each slot should come from a distinct GCP project to actually expand the free-tier 1500-RPD quota |
| google-paid | `GOOGLE_GENERATIVE_AI_API_KEY_PAID` |
| openai | `OPENAI_API_KEY` |
| groq | `GROQ_API_KEY` |
| openrouter | `OPENROUTER_API_KEY` |
| ollama | `OLLAMA_BASE_URL` (yes, the URL — there is no API key) |
| deepinfra | `DEEPINFRA_API_KEY` |
| together | `TOGETHER_API_KEY` |
| deepseek | `DEEPSEEK_API_KEY` (native V4 — `api.deepseek.com`) |
| moonshot | `MOONSHOT_API_KEY` (`MOONSHOT_BASE_URL` optionally overrides Kimi Platform) |
| cohere | `COHERE_API_KEY` |

When more than one Google free key is present, the router expands each
`google:` spec in the chain into one fallback slot per key — so a chain
like `auto:smart` with 4 keys gets 4 Google attempts before falling
through to OpenRouter / DeepInfra / Google-paid. Slots in the log are
tagged `google:gemini-2.5-flash#2` etc. Pool keys live in the separate
`google-paid` provider so paid usage never starts until the entire free
pool is exhausted.

The router skips unavailable providers when building the fallback chain.
If no provider in an alias is available, `resolveModel` throws — which
is intentional: failing loudly during cold start is better than failing
silently in production.

## Budget enforcement

The router enforces per-provider monthly spend caps. Set the cap in USD
via env vars; the router pre-flight-skips a provider whose local usage
estimate has reached 90% of its cap, falling through to the next entry
in the chain. Setting a cap to 0 or omitting the env var leaves the
provider unrestricted (recommended only for `ollama`, `groq` free tier,
and `openrouter` free tier).

Recommended split for a $100/mo total cap. The shape — DeepSeek gets the
biggest slice — comes from where the chain actually lands paid volume:
DeepSeek V4 leads the paid tier in the reasoning-oriented chains
(`auto:smart` / `code` / `big` / `reasoning`), so most paid tokens there
hit it first. DeepInfra remains the ultra-cheap buffer for the
latency/transform chains (`auto:fast` / `translate` / `cheap`), where
DeepSeek's default chain-of-thought would be wasted cost. The remainder
splits between Google-paid (Flash backup to Google-free) and
Together/Anthropic/OpenAI (quality / redundancy reserves).

| Env var | Cap (USD) | Role |
|---------|----:|------|
| `CCO_LLM_BUDGET_DEEPSEEK_USD` | 30 | workhorse — leads paid tier in reasoning chains (thinks by default) |
| `CCO_LLM_BUDGET_GOOGLE_PAID_USD` | 25 | Flash backup to Google free tier |
| `CCO_LLM_BUDGET_DEEPINFRA_USD` | 10 | ultra-cheap buffer; leads paid tier in fast/translate/cheap |
| `CCO_LLM_BUDGET_ANTHROPIC_USD` | 10 | `auto:paid` top-quality reserve |
| `CCO_LLM_BUDGET_OPENAI_USD` | 10 | `auto:paid` redundancy to Anthropic |
| `CCO_LLM_BUDGET_TOGETHER_USD` | 10 | DeepInfra redundancy (different DC) |
| `CCO_LLM_BUDGET_OPENROUTER_USD` | 5 | small buffer for non-`:free` OR models |
| `CCO_LLM_BUDGET_GROQ_USD` | 0 | free tier only (omit env var) |
| `CCO_LLM_BUDGET_MOONSHOT_USD` | 20 | opt-in Kimi K3 pilot ceiling |
| **Total** | **$100** | with 10% router safety margin → effective ceiling ~$90 |

**The router's cap is a safety net, not a hard control.** Set the actual
hard spending limit in each provider's dashboard — the provider will
return 402/429 when reached and the router will fall through naturally.
The local estimate is best-effort: it can drift from the provider's
billing if a call streams partial output before failing, or if the
provider's pricing changes mid-month.

Usage is persisted at `$XDG_STATE_HOME/cco-llm-router/usage.json`
(defaults to `~/.local/state/cco-llm-router/usage.json`). The file is
reset automatically on the first call of a new UTC month.

Inspect current spend:

```bash
$ npx cco-llm-usage
Month: 2026-05  Total: $4.27

provider         calls    in_tokens   out_tokens     cost   budget   used
──────────────────────────────────────────────────────────────────────────────
deepinfra          214    1,820,114      612,003    $0.66   $20.00     3%
google-paid         61      412,000       88,200    $0.06   $10.00     1%
anthropic            9       18,000        4,200    $3.54    $5.00    71%
──────────────────────────────────────────────────────────────────────────────
                                                    Used:   $4.27 / $50.00
```

Exits 1 if any provider is over its cap (handy for cron alerting).

## Conventions

- Every CCO service that talks to an LLM **should** route through this
  package, not call provider SDKs directly. This makes key rotation a
  single-file edit on `/etc/cco/keys.env` instead of N service deploys.
- New aliases land here, not in service-local code. Submit a PR with the
  alias rationale and which services will pick it up.
- Cost-bias the chain head — cheap/free first, paid as fallback —
  unless latency or quality demands the opposite (chat `auto:smart` is
  the canonical exception, and even it now buffers through DeepInfra
  before hitting Anthropic/OpenAI).
