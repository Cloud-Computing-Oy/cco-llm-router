# Opportunistic laptop GPU worker

The router can use a laptop-hosted Ollama instance when the laptop is online,
then immediately fall back to cloud providers when it is unavailable or busy.
The laptop is used by the helper-level automatic task classifier for short,
low-risk work and can also be selected explicitly through
`auto:laptop-assisted`. Existing named aliases are not changed.

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

Select `auto:laptop-assisted` only for workloads suitable for the local model.
When `chat()` or `chatJson()` is called without an alias, the router makes this
selection automatically. Agents can provide `taskKind`/`taskRisk` metadata;
an explicit alias always wins. High-risk, long-context, reasoning,
confidential, and restricted work is kept off this laptop fallback chain.
The router checks `/api/tags` before inference, skips a busy worker, and opens a
60-second circuit after health or inference failures. The chain then continues
with Google free, DeepInfra 8B, and Google paid, subject to configured keys and
budgets.

The router cannot wake a powered-off or sleeping laptop. Keep the laptop awake
when sharing compute; Wake-on-LAN is intentionally outside this first version.
