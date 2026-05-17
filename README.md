# cco-llm-router (Python)

Python sibling of [`@cloud-computing-oy/llm-router`](https://github.com/Cloud-Computing-Oy/cco-llm-router).
Same provider-fallback chains over Anthropic / Google / OpenAI / Groq /
OpenRouter / Ollama, same default aliases, same env-var precedence.
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

## Aliases (cost-first by default)

| Alias            | Chain leader            | Use case                       |
|------------------|-------------------------|--------------------------------|
| `auto:smart`     | gemini-2.5-flash        | Chat, general LLM use          |
| `auto:fast`      | groq-llama-3.3-70b      | Classification, short tasks    |
| `auto:translate` | **ollama:gemma4:26b**   | Batch translation (free first) |
| `auto:code`      | gemini-2.5-flash        | Code generation                |
| `auto:reasoning` | gemini-2.5-pro          | Multi-step planning            |
| `auto:paid`      | gpt-5                   | Premium quality only           |
| `auto:big`       | openrouter free 31B     | Long-context inputs            |
| `auto:local`     | ollama qwen2.5-coder    | Offline / privacy-first        |
| `auto:cheap`     | ollama gemma4:e4b       | Strictly free providers first  |

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
| cohere       | `COHERE_API_KEY`                                                                            |

On CCO infrastructure these are sourced from `/etc/cco/keys.env`,
mounted into containers by the docker-compose `env_file:`.

## Status

**Skeleton (v0.1.0).** Implementation is complete enough for migrating
existing Python services (ai-chatbot, lexai-chatbot, knowledge-assistant,
strategy-dashboard) — see the TypeScript sibling's MIGRATION.md for
context on each. End-to-end smoke testing on a real service is the
next step before tagging v0.2.0.
