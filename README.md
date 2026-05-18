# @cloud-computing-oy/llm-router

Shared LLM router for Cloud-Computing-Oy services. Provider-fallback
chains over Anthropic / Google / OpenAI / Groq / OpenRouter / Ollama,
plus a Cohere rerank helper.

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

Available default aliases:

| Alias | Use case | Chain |
|-------|----------|-------|
| `auto:smart` | Chat, latency-sensitive | google → anthropic → openai → groq |
| `auto:fast` | Classification, short tasks | groq → google → anthropic-haiku → openai-mini |
| `auto:translate` | Batch translation | **ollama-gemma** → google → anthropic |
| `auto:reasoning` | Planning, multi-step | openai → anthropic → google-pro |
| `auto:cheap` | Cost-first, OSS models | ollama → groq → openrouter-free → google |

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
| cohere | `COHERE_API_KEY` |

The router skips unavailable providers when building the fallback chain.
If no provider in an alias is available, `resolveModel` throws — which
is intentional: failing loudly during cold start is better than failing
silently in production.

## Conventions

- Every CCO service that talks to an LLM **should** route through this
  package, not call provider SDKs directly. This makes key rotation a
  single-file edit on `/etc/cco/keys.env` instead of N service deploys.
- New aliases land here, not in service-local code. Submit a PR with the
  alias rationale and which services will pick it up.
- Cost-bias the chain head — cheap/free first, paid as fallback —
  unless latency or quality demands the opposite (chat `auto:smart` is
  the canonical exception).
