# FACF opportunistic laptop GPU worker

The router can use a laptop-hosted Ollama instance as a FACF Phase 0 provider when the laptop is online,
then immediately fall back to cloud providers when it is unavailable or busy.
The laptop is used by the helper-level automatic task classifier for short,
low-risk public or synthetic work and can also be selected explicitly through
`auto:facf-laptop`. The legacy `auto:laptop-assisted` alias remains compatible
and has the same data guard.

## Laptop

Install Ollama and Tailscale, keep Ollama bound to localhost, and expose it only
inside the tailnet:

```sh
ollama pull qwen2.5:7b
tailscale serve --bg http://127.0.0.1:11434
tailscale serve status
```

Do not use Tailscale Funnel. Restrict the Serve endpoint to the router host with
a Tailscale grant or ACL.

Ollama starts automatically after installation on macOS and Windows. On Linux,
enable its systemd unit:

```sh
sudo systemctl enable --now ollama
```

Use these Ollama environment settings so the server stays lightweight and the
model releases VRAM shortly after the burst ends:

```text
OLLAMA_KEEP_ALIVE=2m
OLLAMA_MAX_LOADED_MODELS=1
OLLAMA_NUM_PARALLEL=1
OLLAMA_MAX_QUEUE=2
```

## Router host

Set the private Tailscale Serve URL in the consuming service environment and
restart that service:

```text
OLLAMA_BASE_URL=https://laptop-name.tailnet-name.ts.net
CCO_LLM_OLLAMA_HEALTH_TIMEOUT_MS=1500
CCO_LLM_OLLAMA_REQUEST_TIMEOUT_MS=120000
CCO_LLM_OLLAMA_CIRCUIT_OPEN_MS=60000
CCO_LLM_OLLAMA_HEALTH_CACHE_MS=5000
CCO_LLM_OLLAMA_MAX_CONCURRENT=1
```

Select `auto:facf-laptop` only for workloads suitable for the local model and
set `dataClass` to `public` or `synthetic`. Unclassified data defaults to
`internal` and is never sent to a FACF laptop. The legacy
`auto:laptop-assisted` alias enforces the same rule.
When `chat()` or `chatJson()` is called without an alias, the router makes this
selection automatically only for explicitly public or synthetic data. Agents
can provide `taskKind`/`taskRisk` metadata;
an explicit alias always wins. High-risk, long-context, reasoning,
confidential, and restricted work is kept off this laptop fallback chain.
The router checks `/api/tags`, verifies the requested model is installed before
inference, skips a busy worker, and opens a
60-second circuit after health or inference failures. The chain then continues
with Google free, DeepInfra 8B, and Google paid, subject to configured keys and
budgets.

The router cannot wake a powered-off or sleeping laptop. Keep the laptop awake
when sharing compute; Wake-on-LAN is intentionally outside this first version.

A 403 from a process outside the tailnet is expected. Do not work around it by
enabling Funnel or exposing Ollama publicly.

```ts
await chat({
  system: 'Summarise accurately.',
  prompt: publicText,
  dataClass: 'public',
});
```
