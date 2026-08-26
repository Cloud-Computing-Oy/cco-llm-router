# cco-llm-router for Python

Python binding for the provider-neutral
[`cco-llm-router`](https://github.com/Cloud-Computing-Oy/cco-llm-router).
It mirrors the TypeScript aliases, provider availability, local budget
estimates, usage reporting, and public-data pilot policy.

## Install

Until a public PyPI release is announced, install a pinned Git tag or local
checkout. Provider SDKs are optional:

```bash
pip install 'cco-llm-router[all]'
pip install 'cco-llm-router[openai]'
pip install 'cco-llm-router[google]'
pip install 'cco-llm-router[anthropic]'
```

## Usage

```python
from cco_llm_router import chat, chat_json, resolve_model

answer = chat(
    system="You are a helpful assistant.",
    prompt="Hello!",
    data_class="internal",
)

data = chat_json(
    system="Reply only with JSON.",
    prompt="Return an object with keys a and b.",
    alias="auto:smart",
    data_class="internal",
)

callspec = resolve_model("auto:reasoning", data_class="internal")
print([spec.label for spec in callspec.specs])
```

Direct selectors obey the local budget guard by default. The
`bypass_budget=True` override should require application authorization.

## Public-data pilot

Kimi is never included in a normal fallback chain. It requires both explicit
pilot approval and a public data classification:

```python
callspec = resolve_model(
    "auto:kimi-pilot",
    allow_pilot=True,
    data_class="public",
)
```

The router rejects internal, confidential, and restricted classifications for
this pilot. It does not inspect prompt contents, so callers remain responsible
for correct classification, minimization, consent, residency, and provider
approval.

## Environment variables

Provider credentials are read from environment variables such as
`ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `OPENAI_API_KEY`,
`GROQ_API_KEY`, `OPENROUTER_API_KEY`, `DEEPINFRA_API_KEY`,
`TOGETHER_API_KEY`, `DEEPSEEK_API_KEY`, `MOONSHOT_API_KEY`, and
`COHERE_API_KEY`. Ollama uses `OLLAMA_BASE_URL`.

Keep credentials in a deployment secret manager. Never commit them or include
them in prompts, generated plans, logs, or issue reports.

For an intermittent laptop GPU, set `OLLAMA_BASE_URL` to its private Tailscale
Serve URL and select `auto:laptop-assisted`. The router health-checks the
worker, limits it to one concurrent request by default, and temporarily opens
a circuit after a failure. See the repository's
[`docs/laptop-gpu-worker.md`](../docs/laptop-gpu-worker.md) for setup.

## Budget and usage boundary

`CCO_LLM_BUDGET_<PROVIDER>_USD` variables provide an optional local monthly
safety net. At 90% of a configured cap, a provider is skipped for new alias
requests. Configure actual hard limits in each provider's dashboard.

Local tracking is best-effort and per host. It can drift from billing, lose
concurrent updates, fail to persist, or omit usage from other hosts. It is not
a financial or security boundary.

Inspect estimates with `cco-llm-usage`. State is stored at
`$XDG_STATE_HOME/cco-llm-router/usage.json`, defaulting to
`~/.local/state/cco-llm-router/usage.json`.

## Development

```bash
python -m pip install -e '.[dev]'
python -m pytest tests
python -m ruff check .
```

Licensed under Apache-2.0.
