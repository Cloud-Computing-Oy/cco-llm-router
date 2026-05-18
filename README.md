# @cloud-computing-oy/llm-router

Shared LLM router for Cloud-Computing-Oy services. Provider-fallback
chains over Anthropic / Google / OpenAI / Groq / OpenRouter / Ollama /
DeepInfra / Together, plus a Cohere rerank helper and per-provider
monthly budget enforcement.

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

Available default aliases (always free → ultra-cheap → cheap → expensive):

| Alias | Use case | Chain (cost-optimised) |
|-------|----------|------------------------|
| `auto:smart` | Chat, generic | google-free → openrouter-free → **deepinfra-70b** → google-paid → together → anthropic → openai |
| `auto:fast` | Classification, short tasks | groq-free → google-free → openrouter-free → **deepinfra-8b** → google-paid → openai-mini |
| `auto:translate` | Batch translation | ollama → google-free → **deepinfra-70b** → google-paid → anthropic |
| `auto:code` | Code generation | google-free → openrouter-free → groq-free → **deepinfra-70b** → google-paid → openai-mini |
| `auto:reasoning` | Planning, multi-step | google-free-pro → openrouter-free → **deepinfra-deepseek-v3** → google-paid-pro → anthropic → openai |
| `auto:big` | Long context | openrouter-free → google-free-pro → **deepinfra-70b** → google-paid-pro → openai |
| `auto:cheap` | Cost-first, strict | ollama → openrouter-free → groq-free → google-free → **deepinfra-8b** → **deepinfra-70b** → google-paid-flash |
| `auto:paid` | Top quality, opt-in | openai → anthropic → google-paid-pro |
| `auto:local` | Air-gapped | ollama only |

You can also call a provider directly without going through the fallback
chain (useful when you genuinely need a specific model and don't want
quiet degradation):

```ts
const { model } = resolveModel('anthropic:claude-sonnet-4-6');
```

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
| google | `GOOGLE_GENERATIVE_AI_API_KEY_PAID` ▸ `GOOGLE_GENERATIVE_AI_API_KEY` ▸ `GOOGLE_GENAI_API_KEY` ▸ `GEMINI_API_KEY` |
| openai | `OPENAI_API_KEY` |
| groq | `GROQ_API_KEY` |
| openrouter | `OPENROUTER_API_KEY` |
| ollama | `OLLAMA_BASE_URL` (yes, the URL — there is no API key) |
| deepinfra | `DEEPINFRA_API_KEY` |
| together | `TOGETHER_API_KEY` |
| cohere | `COHERE_API_KEY` |

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

Recommended split for a $100/mo total cap. The shape — DeepInfra gets
the biggest slice — comes from where the chain actually lands paid
volume: ~80% of paid tokens hit the first paid candidate (DeepInfra),
the remainder splits between Google-paid (Flash backup to Google-free),
Together/Anthropic/OpenAI (quality / redundancy reserves).

| Env var | Cap (USD) | Role |
|---------|----:|------|
| `CCO_LLM_BUDGET_DEEPINFRA_USD` | 40 | workhorse — first paid in every chain |
| `CCO_LLM_BUDGET_GOOGLE_PAID_USD` | 25 | Flash backup to Google free tier |
| `CCO_LLM_BUDGET_ANTHROPIC_USD` | 10 | `auto:paid` top-quality reserve |
| `CCO_LLM_BUDGET_OPENAI_USD` | 10 | `auto:paid` redundancy to Anthropic |
| `CCO_LLM_BUDGET_TOGETHER_USD` | 10 | DeepInfra redundancy (different DC) |
| `CCO_LLM_BUDGET_OPENROUTER_USD` | 5 | small buffer for non-`:free` OR models |
| `CCO_LLM_BUDGET_GROQ_USD` | 0 | free tier only (omit env var) |
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
