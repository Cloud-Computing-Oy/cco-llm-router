# @cloud-computing-oy/llm-router

Open-source, provider-neutral LLM router maintained by Cloud-Computing-Oy. Provider-fallback
chains over Anthropic / Google / DeepSeek / Moonshot / OpenAI / Groq / OpenRouter /
Ollama / DeepInfra / Together, plus a Cohere rerank helper and
local monthly budget estimates.

The router reads API keys from `process.env` at runtime. Keep credentials in
your deployment platform's secret store; never commit them to this repository.

## Repo layout

This repo carries both language bindings of the router:

- **Root (TypeScript / Node)** — package name
  `@cloud-computing-oy/llm-router`.
- **[`py/`](./py)** — Python sibling package `cco-llm-router`.

Each subdirectory owns its own packaging (`package.json` for TS at root,
`pyproject.toml` under `py/`). The default alias chains in
`src/router.ts` and `py/cco_llm_router/router.py` should stay in sync
when adding new providers or shifting model defaults.

## Install

The source repository is public. Until a public package-registry release is
announced, install a pinned Git tag directly from GitHub:

```json
{
  "dependencies": {
    "@cloud-computing-oy/llm-router": "git+https://github.com/Cloud-Computing-Oy/cco-llm-router.git#v0.12.0"
  }
}
```

Do not use a moving branch for production. npm/PyPI publication is a separate
release decision from making the source public.

## Usage

```ts
import { resolveModel } from '@cloud-computing-oy/llm-router';
import { generateText } from 'ai';

const { model } = resolveModel('auto:smart', { dataClass: 'internal' });
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
const { model } = resolveModel('anthropic:claude-sonnet-4-6', {
  dataClass: 'internal',
});
```

Direct selectors still obey the local budget guard. Bypassing it requires the
explicit `bypassBudget: true` option and should be protected by application
authorization.

### Kimi K3 pilot

Kimi K3 is intentionally opt-in and is not present in any existing default
fallback chain. Configure a Kimi Platform key and select the pilot alias:

```bash
MOONSHOT_API_KEY=sk-...
MOONSHOT_BASE_URL=https://api.moonshot.ai/v1 # optional override
CCO_LLM_BUDGET_MOONSHOT_USD=20
```

```ts
const { model } = resolveModel('auto:kimi-pilot', {
  allowPilot: true,
  dataClass: 'public',
});
// Equivalent direct selection: moonshot:kimi-k3
```

Kimi K3 currently accepts only `temperature: 1`; omit the parameter or set it
to `1`. The global Kimi Platform key uses `https://api.moonshot.ai/v1`.
Regional Kimi Platform keys are not interchangeable with the separate
`https://api.moonshot.cn/v1` service, so override `MOONSHOT_BASE_URL` only when
the key was issued for that endpoint.

The provider is pinned to the OpenAI-compatible Chat Completions protocol;
Moonshot does not expose the OpenAI Responses endpoint used by the AI SDK's
default OpenAI model constructor.

The router rejects this alias and direct `moonshot:*` selectors unless the
caller supplies both `allowPilot: true` and `dataClass: 'public'`. Never
misclassify internal, personal, customer, legal, financial, regulated,
confidential, or restricted data to enable a provider.

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
const { model } = router.resolveModel('my-service:summarise', {
  dataClass: 'internal',
});
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

Set budgets from your own workload, provider contracts, and measured usage.
The following values are examples only:

| Env var | Cap (USD) | Role |
|---------|----:|------|
| `CCO_LLM_BUDGET_DEEPSEEK_USD` | 20 | reasoning workload example |
| `CCO_LLM_BUDGET_GOOGLE_PAID_USD` | 20 | paid fallback example |
| `CCO_LLM_BUDGET_DEEPINFRA_USD` | 10 | economical fallback example |
| `CCO_LLM_BUDGET_ANTHROPIC_USD` | 10 | quality reserve example |
| `CCO_LLM_BUDGET_OPENAI_USD` | 10 | quality reserve example |
| `CCO_LLM_BUDGET_TOGETHER_USD` | 10 | provider redundancy example |
| `CCO_LLM_BUDGET_OPENROUTER_USD` | 5 | non-free model example |
| `CCO_LLM_BUDGET_GROQ_USD` | 0 | free tier only (omit env var) |
| `CCO_LLM_BUDGET_MOONSHOT_USD` | 20 | opt-in Kimi K3 pilot ceiling |
| **Configured example** | **$105** | each provider is evaluated independently |

**The router's cap is a safety net, not a hard control.** Set the actual
hard spending limit in each provider's dashboard — the provider will
return 402/429 when reached and the router will fall through naturally.
The local estimate is best-effort and per host. It can drift from provider
billing, lose updates under concurrent writes, fail to persist, or omit costs
from other hosts. A direct selector observes the guard by default, but an
explicit bypass can override it. Never rely on this mechanism as a financial
or security boundary.

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

## Security and governance

- Store keys in an environment-specific secret manager and rotate them
  independently of application releases.
- Treat the caller-supplied data class as a policy assertion, not automatic
  content detection. Applications remain responsible for data minimization,
  consent, residency, retention, and provider approval.
- Review every provider in an alias before using it with non-public data.
- Add new aliases through a pull request with cost, reliability, privacy, and
  fallback rationale plus matching TypeScript and Python tests.
- Verify model names and pricing against authoritative provider sources before
  every release.

See [SECURITY.md](SECURITY.md), [CONTRIBUTING.md](CONTRIBUTING.md), and
[MIGRATION.md](MIGRATION.md). Release changes are recorded in
[CHANGELOG.md](CHANGELOG.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
