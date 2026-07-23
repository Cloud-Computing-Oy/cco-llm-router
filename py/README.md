# cco-llm-router (Python)

Python sibling of [`@cloud-computing-oy/llm-router`](https://github.com/Cloud-Computing-Oy/cco-llm-router).
Same provider-fallback chains over Anthropic / Google / Moonshot / OpenAI / Groq /
OpenRouter / Ollama / DeepInfra / Together, same default aliases, same
env-var precedence, same per-provider monthly budget enforcement.
Cohere rerank lives in `cco_llm_router.cohere`.

For CCO services this package is the FastAPI-side counterpart of the
TypeScript router used in Next.js services. Adopt it in a Python
codebase so a single key rotation in `/etc/cco/keys.env` propagates
everywhere.

## Install

```bash
pip install 'cco-llm-router[all]'         # everything
pip install 'cco-llm-router[openai]'      # just OpenAI-compatible
pip install 'cco-llm-router[google]'      # just Google Gemini
pip install 'cco-llm-router[anthropic]'   # just Anthropic
```

The base install has no provider deps so you can keep the install
small for services that only talk to one or two providers.

## Usage

```python
from cco_llm_router import chat, chat_json, resolve_model

# Default alias is auto:smart (cheapest smart-tier first).
answer = chat(system="You are a helpful assistant.",
              prompt="Hello!")

# Free local Gemma → paid Gemini fallback (cost-first).
translated = chat(system="Translate to Finnish.",
                  prompt="Hello world.",
                  alias="auto:translate")

# JSON output, with ```json-fence stripping and None on parse failure.
data = chat_json(
    system="Reply only with JSON.",
    prompt="Give me an object with keys 'a' and 'b'.",
)

# Manual resolution for streaming, custom timeouts, etc.
callspec = resolve_model("auto:reasoning")
print([s.label for s in callspec.specs])
```

## Aliases (cost-first by default — DeepInfra slots in as ultra-cheap buffer)

| Alias            | Chain leader            | Use case                       |
|------------------|-------------------------|--------------------------------|
| `auto:smart`     | gemini-2.5-flash        | Chat, general LLM use          |
| `auto:fast`      | groq-llama-3.3-70b      | Classification, short tasks    |
| `auto:translate` | **ollama:qwen2.5:14b**  | Batch translation (free first) |
| `auto:code`      | gemini-2.5-flash        | Code generation                |
| `auto:reasoning` | gemini-2.5-pro          | Multi-step planning            |
| `auto:paid`      | gpt-5                   | Premium quality only           |
| `auto:big`       | openrouter free 31B     | Long-context inputs            |
| `auto:local`     | ollama qwen2.5-coder    | Offline / privacy-first        |
| `auto:cheap`     | ollama gemma4:e4b       | Strictly free + ultra-cheap    |
| `auto:kimi-pilot` | moonshot:kimi-k3        | Explicit long-context pilot    |

`resolve_model('provider:model')` works too — e.g. `google-paid:gemini-2.5-pro`
to bypass the chain entirely.

## Env vars

| Provider     | Env var(s)                                                                                  |
|--------------|---------------------------------------------------------------------------------------------|
| anthropic    | `ANTHROPIC_API_KEY`                                                                         |
| google       | `GOOGLE_GENERATIVE_AI_API_KEY` ▸ `GOOGLE_GENAI_API_KEY` ▸ `GEMINI_API_KEY`                  |
| google-paid  | `GOOGLE_GENERATIVE_AI_API_KEY_PAID`                                                         |
| openai       | `OPENAI_API_KEY`                                                                            |
| groq         | `GROQ_API_KEY`                                                                              |
| openrouter   | `OPENROUTER_API_KEY`                                                                        |
| ollama       | `OLLAMA_BASE_URL`                                                                           |
| deepinfra    | `DEEPINFRA_API_KEY`                                                                         |
| together    | `TOGETHER_API_KEY`                                                                          |
| moonshot    | `MOONSHOT_API_KEY` (`MOONSHOT_BASE_URL` optional)                                            |
| cohere       | `COHERE_API_KEY`                                                                            |

On CCO infrastructure these are sourced from `/etc/cco/keys.env`,
mounted into containers by the docker-compose `env_file:`.

## Budget enforcement

Recommended split for a $100/mo total cap — DeepInfra gets the biggest
slice because ~80% of paid tokens land there (it's the first paid
candidate in every chain):

| Env var | Cap (USD) | Role |
|---------|----:|------|
| `CCO_LLM_BUDGET_DEEPINFRA_USD` | 40 | workhorse — first paid in every chain |
| `CCO_LLM_BUDGET_GOOGLE_PAID_USD` | 25 | Flash backup to Google free tier |
| `CCO_LLM_BUDGET_ANTHROPIC_USD` | 10 | `auto:paid` top-quality reserve |
| `CCO_LLM_BUDGET_OPENAI_USD` | 10 | `auto:paid` redundancy to Anthropic |
| `CCO_LLM_BUDGET_TOGETHER_USD` | 10 | DeepInfra redundancy (different DC) |
| `CCO_LLM_BUDGET_OPENROUTER_USD` | 5 | small buffer for non-`:free` OR models |
| `CCO_LLM_BUDGET_GROQ_USD` | 0 | free tier only (omit env var) |

When local estimated spend reaches 90% of a cap, the router treats that
provider as unavailable for new requests and falls through to the next
candidate. The actual hard control should be set in each provider's
dashboard — this is a safety net, not the primary stop.

State persists at `$XDG_STATE_HOME/cco-llm-router/usage.json` (defaults
to `~/.local/state/cco-llm-router/usage.json`). The file is shared with
the TypeScript sibling, so a host running both aggregates into one view.

Inspect current spend with `cco-llm-usage` (exits 1 over any cap):

```bash
$ cco-llm-usage
Month: 2026-05  Total: $40.80

provider         calls     in_tokens    out_tokens      cost    budget    used
──────────────────────────────────────────────────────────────────────────────
anthropic            1       500,000       100,000     $3.00    $10.00     30%
deepinfra            1    60,000,000    60,000,000    $37.80    $40.00     94%
──────────────────────────────────────────────────────────────────────────────
                                                            Used: $40.80 / $50.00
```

## Status

**v0.2.0 — feature parity with the TS 0.4.0.** DeepInfra + Together
providers, per-provider monthly budget enforcement, `cco-llm-usage`
CLI, end-to-end usage tracking on every successful call.
