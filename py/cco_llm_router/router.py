"""Provider-aware routing with fallback chains.

Mirrors the TypeScript router in @cloud-computing-oy/llm-router but
implemented natively with provider SDKs (anthropic, google-genai,
openai/groq/openrouter/deepinfra/together via OpenAI-compatible API,
ollama via httpx).

Each alias resolves to a Spec list filtered by `available` (key set +
within monthly budget) and a `call_chain` callable that walks the list,
trying every available provider after any provider failure. Token usage is
recorded after every successful call.
"""
from __future__ import annotations

import os
import time
from collections.abc import Callable
from typing import Any

from . import providers
from .budget import within_budget
from .catalog import has_reviewed_automatic_pricing, requires_unknown_pricing_approval
from .providers.google import google_key_count
from .types import Provider, Spec
from .usage import record_usage

# Default fallback chains — mirror src/router.ts (the TS sibling is the
# source of truth; keep these in sync).
#
# Reliable-only (matches TS 0.8.0+): OpenRouter ":free" models and Ollama
# are EXCLUDED from every default chain — free OpenRouter models emit
# prose instead of structured output, and CPU-only dev/hub Ollama misses
# real-prompt timeouts. Both remain selectable via auto:local / explicit
# aliases.
#
# DeepSeek V4 Flash/Pro think by default (chain-of-thought, verified
# 2026-05-27 against api.deepseek.com), so they sit only where reasoning
# earns its latency + output-token cost (auto:smart/code/big/reasoning)
# and are kept OUT of auto:fast/translate/cheap. Non-thinking needs
# thinking:{type:"disabled"} in the request body, which a plain Spec
# can't carry.
#
# Cost reference (input / output per M tokens, May 2026):
#   groq:qwen3.6-27b                 free (rate-limited)
#   google:gemini-2.5-flash          free tier — 1500 RPD per GCP project
#   deepinfra:llama-3.1-8b           $0.04  / $0.04
#   deepseek:deepseek-v4-flash       $0.14  / $0.28   (reasoning, thinks by default)
#   google-paid:gemini-2.5-flash     $0.075 / $0.30
#   deepinfra:llama-3.3-70b          $0.23  / $0.40
#   deepseek:deepseek-v4-pro         $0.435 / $0.87
#   together:llama-3.3-70b-lite      $0.54  / $0.88
#   openai:gpt-5-mini                $0.25  / $2
#   google-paid:gemini-2.5-pro       $1.25  / $5
#   anthropic:claude-sonnet-4-6      $3     / $15
#   openai:gpt-5                     $3     / $15
DEFAULT_ALIASES: dict[str, list[Spec]] = {
    # DeepSeek V4 Flash leads for reliability (see comment above);
    # everything after it is price-ordered ascending ($/M input+output),
    # treating prices within $0.25/M of each other as a tie and keeping the
    # prior curated order there so a marginally cheaper generalist model
    # can't bump a task-suited specialist (e.g. GLM stays ahead of plain
    # Llama-3.3-70B). Mirrors src/router.ts.
    "auto:smart": [
        Spec("deepseek", "deepseek-v4-flash"),
        Spec("google", "gemini-2.5-flash"),
        Spec("google", "gemini-2.5-pro"),
        Spec("google-paid", "gemini-2.5-flash"),
        Spec("zai", "glm-5.3-flash"),
        Spec("deepinfra", "meta-llama/Meta-Llama-3.3-70B-Instruct"),
        Spec("together", "meta-llama/Llama-3.3-70B-Instruct-Lite"),
        Spec("deepseek", "deepseek-v4-pro"),
        Spec("zai", "glm-5.3"),
        Spec("google-paid", "gemini-2.5-pro"),
        Spec("anthropic", "claude-sonnet-4-6"),
        Spec("openai", "gpt-5"),
        Spec("moonshot", "kimi-k3"),
    ],
    "auto:fast": [
        Spec("groq", "qwen/qwen3.6-27b"),
        Spec("google", "gemini-2.5-flash"),
        Spec("deepinfra", "meta-llama/Meta-Llama-3.1-8B-Instruct"),
        Spec("google-paid", "gemini-2.5-flash"),
        Spec("openai", "gpt-5-mini"),
        Spec("anthropic", "claude-haiku-4-5-20251001"),
    ],
    "auto:translate": [
        Spec("google", "gemini-2.5-flash"),
        Spec("deepinfra", "meta-llama/Meta-Llama-3.3-70B-Instruct"),
        Spec("google-paid", "gemini-2.5-flash"),
        Spec("anthropic", "claude-sonnet-4-6"),
    ],
    # Price-ordered after DeepSeek V4 Flash, same $0.25/M tie rule as
    # auto:smart above.
    "auto:code": [
        Spec("deepseek", "deepseek-v4-flash"),
        Spec("google", "gemini-2.5-flash"),
        Spec("groq", "qwen/qwen3.6-27b"),
        Spec("google-paid", "gemini-2.5-flash"),
        Spec("zai", "glm-5.3-flash"),
        Spec("deepinfra", "meta-llama/Meta-Llama-3.3-70B-Instruct"),
        Spec("openai", "gpt-5-mini"),
        Spec("zai", "glm-5.3"),
    ],
    # Price-ordered after DeepSeek V4 Flash, same $0.25/M tie rule as
    # auto:smart above.
    "auto:reasoning": [
        Spec("deepseek", "deepseek-v4-flash"),
        Spec("google", "gemini-2.5-pro"),
        Spec("zai", "glm-5.3-flash"),
        Spec("deepseek", "deepseek-v4-pro"),
        Spec("deepinfra", "deepseek-ai/DeepSeek-V3"),
        Spec("zai", "glm-5.3"),
        Spec("google-paid", "gemini-2.5-pro"),
        Spec("anthropic", "claude-sonnet-4-6"),
        Spec("openai", "gpt-5"),
        Spec("moonshot", "kimi-k3"),
    ],
    "auto:paid": [
        Spec("openai", "gpt-5"),
        Spec("openai", "gpt-5-mini"),
        Spec("anthropic", "claude-sonnet-4-6"),
        Spec("google-paid", "gemini-2.5-pro"),
        Spec("moonshot", "kimi-k3"),
    ],
    # Price-ordered after DeepSeek V4 Flash, same $0.25/M tie rule as
    # auto:smart above.
    "auto:big": [
        Spec("deepseek", "deepseek-v4-flash"),
        Spec("google", "gemini-2.5-pro"),
        Spec("zai", "glm-5.3-flash"),
        Spec("deepinfra", "meta-llama/Meta-Llama-3.3-70B-Instruct"),
        Spec("zai", "glm-5.3"),
        Spec("google-paid", "gemini-2.5-pro"),
        Spec("openai", "gpt-5"),
        Spec("moonshot", "kimi-k3"),
    ],
    "auto:local": [
        Spec("ollama", "qwen2.5:14b"),
        Spec("ollama", "gemma4:e2b"),
    ],
    "auto:laptop-assisted": [
        Spec("ollama", "qwen2.5:7b"),
        Spec("google", "gemini-2.5-flash"),
        Spec("deepinfra", "meta-llama/Meta-Llama-3.1-8B-Instruct"),
        Spec("google-paid", "gemini-2.5-flash"),
    ],
    "auto:facf-laptop": [
        Spec("ollama", "qwen2.5:7b"),
        Spec("google", "gemini-2.5-flash"),
        Spec("deepinfra", "meta-llama/Meta-Llama-3.1-8B-Instruct"),
        Spec("google-paid", "gemini-2.5-flash"),
    ],
    "auto:cheap": [
        Spec("groq", "qwen/qwen3.6-27b"),
        Spec("google", "gemini-2.5-flash"),
        Spec("deepinfra", "meta-llama/Meta-Llama-3.1-8B-Instruct"),
        Spec("deepinfra", "meta-llama/Meta-Llama-3.3-70B-Instruct"),
        Spec("google-paid", "gemini-2.5-flash"),
    ],
    # Kimi K3 direct-only alias. No longer gated: Moonshot is now natively
    # OpenAI/Anthropic-protocol compatible and ships in the top-tier default
    # chains above (auto:smart/reasoning/paid/big); this alias remains for
    # callers who want Kimi K3 specifically without the rest of the chain.
    "auto:kimi-pilot": [
        Spec("moonshot", "kimi-k3"),
    ],
    # Explicit GLM Flash pilot; never selected by an existing default alias.
    "auto:glm-flash-pilot": [
        Spec("zai", "glm-5.3-flash"),
    ],
    "family:qwen": [
        Spec("groq", "qwen/qwen3.6-27b"),
        Spec("dashscope", "qwen3.8-max"),
    ],
    "family:kimi": [Spec("moonshot", "kimi-k3")],
    "family:glm": [Spec("zai", "glm-5.3-flash"), Spec("zai", "glm-5.3")],
    "family:llama": [Spec("ollama", "llama4:scout")],
    "family:minimax": [
        Spec("minimax", "MiniMax-M2.7"),
        Spec("nvidia", "minimaxai/minimax-m2.7"),
    ],
    "family:mistral": [
        Spec("mistral", "mistral-large-latest"),
        Spec("nvidia", "mistralai/mistral-nemotron"),
    ],
    "family:gemma": [Spec("ollama", "gemma3:27b")],
    "family:nemotron": [Spec("nvidia", "nvidia/nemotron-3-super-120b-a12b")],
}


_HAS_KEY: dict[str, Callable[[], bool]] = {
    "anthropic": lambda: bool(os.environ.get("ANTHROPIC_API_KEY")),
    "google": lambda: bool(
        os.environ.get("GOOGLE_GENERATIVE_AI_API_KEY")
        or os.environ.get("GOOGLE_GENAI_API_KEY")
        or os.environ.get("GEMINI_API_KEY")
    ),
    "google-paid": lambda: bool(os.environ.get("GOOGLE_GENERATIVE_AI_API_KEY_PAID")),
    "openai": lambda: bool(os.environ.get("OPENAI_API_KEY")),
    "groq": lambda: bool(os.environ.get("GROQ_API_KEY")),
    "openrouter": lambda: bool(os.environ.get("OPENROUTER_API_KEY")),
    "ollama": lambda: bool(os.environ.get("OLLAMA_BASE_URL")),
    "deepinfra": lambda: bool(os.environ.get("DEEPINFRA_API_KEY")),
    "together": lambda: bool(os.environ.get("TOGETHER_API_KEY")),
    "deepseek": lambda: bool(os.environ.get("DEEPSEEK_API_KEY")),
    "moonshot": lambda: bool(os.environ.get("MOONSHOT_API_KEY")),
    "dashscope": lambda: bool(os.environ.get("DASHSCOPE_API_KEY")),
    "zai": lambda: bool(os.environ.get("ZAI_API_KEY")),
    "minimax": lambda: bool(os.environ.get("MINIMAX_API_KEY")),
    "mistral": lambda: bool(os.environ.get("MISTRAL_API_KEY")),
    "nvidia": lambda: bool(os.environ.get("NVIDIA_API_KEY")),
}


def _has_key(name: str) -> bool:
    fn = _HAS_KEY.get(name)
    return bool(fn and fn())


def _provider_available(name: str) -> bool:
    """Available = key set AND within monthly budget. Budget check is
    skipped on direct provider:model resolution so callers can force a
    specific model regardless of cap (e.g. for a one-off important job)."""
    return _has_key(name) and within_budget(name)


class CallSpec:
    """A resolved (alias-or-direct) spec list with a ready-to-call callable.

    `call(system, prompt, **kwargs)` walks the available chain, falling
    through to the next provider on every provider error. Raises after the
    entire chain fails. Token usage is recorded after each successful
    call into the local monthly tracker.
    """

    def __init__(self, specs: list[Spec]):
        self.specs = specs

    def call(
        self,
        *,
        system: str,
        prompt: str,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        last_err: Exception | None = None
        for attempt in range(2):
            all_transient = True
            for spec in self.specs:
                try:
                    text, usage = providers.call(
                        spec,
                        system=system,
                        prompt=prompt,
                        temperature=temperature,
                        max_tokens=max_tokens,
                    )
                    if usage:
                        try:
                            record_usage(
                                spec.provider,
                                spec.model,
                                usage.get("input_tokens", 0),
                                usage.get("output_tokens", 0),
                            )
                        except Exception:  # noqa: BLE001, S110 - usage must not break inference
                            # Usage tracking must never break inference.
                            pass
                    return text
                except Exception as e:  # noqa: BLE001 - provider isolation is the fallback contract
                    print(f"[fallback] {spec.label} failed: {e} — trying next")
                    last_err = e
                    all_transient = all_transient and isinstance(
                        e, providers.TransientError
                    )
            if attempt == 0 and all_transient:
                print(
                    "[fallback] entire chain failed transiently, "
                    "waiting 8000ms then retrying once"
                )
                time.sleep(8)
                continue
            break
        raise RuntimeError(
            f"All providers failed for chain [{', '.join(s.label for s in self.specs)}]: {last_err}"
        )


def resolve_model(
    alias: str,
    *,
    aliases: dict[str, list[Spec]] | None = None,
    data_class: str = "internal",
    bypass_budget: bool = False,
    allow_unknown_pricing: bool = False,
) -> CallSpec:
    """Resolve an alias to a CallSpec with the available subset of the chain.

    Pass `alias` as either:
      - A registered alias like "auto:smart"
      - A direct "provider:model" string (e.g. "anthropic:claude-sonnet-4-6")

    The FACF laptop routes require public/synthetic data. Direct calls obey
    the local budget safety net unless ``bypass_budget=True`` is approved.
    """
    if data_class not in {"public", "synthetic", "internal", "confidential", "restricted"}:
        raise ValueError(f"Unknown data class: {data_class}")
    if alias in {"auto:facf-laptop", "auto:laptop-assisted"} and data_class not in {
        "public",
        "synthetic",
    }:
        raise RuntimeError(
            'FACF laptop routes accept only data_class="public" or "synthetic"'
        )
    if ":" in alias and not alias.startswith(("auto:", "family:")):
        provider, _, model = alias.partition(":")
        if not _has_key(provider):
            raise RuntimeError(f"Provider not available: {provider} (missing key?)")
        if not bypass_budget and not within_budget(provider):
            raise RuntimeError(
                f"Provider budget unavailable: {provider}; "
                "bypass_budget requires explicit approval"
            )
        spec = Spec(provider, model)
        if not allow_unknown_pricing and requires_unknown_pricing_approval(spec):
            raise RuntimeError(
                f"Pricing is not reviewed for {spec.label}; "
                "set allow_unknown_pricing=True"
            )
        return CallSpec([spec])

    table = aliases if aliases is not None else DEFAULT_ALIASES
    chain = table.get(alias)
    if chain is None:
        raise RuntimeError(f"Unknown model alias: {alias}")

    available_by_key = [s for s in chain if _provider_available(s.provider)]
    filtered = (
        available_by_key
        if allow_unknown_pricing
        else [s for s in available_by_key if has_reviewed_automatic_pricing(s)]
    )
    available = _expand_google_keys(filtered)
    if not available:
        if available_by_key and not allow_unknown_pricing:
            raise RuntimeError(
                f"No reviewed-price provider for alias {alias}; "
                "set allow_unknown_pricing=True"
            )
        raise RuntimeError(
            f"No available provider for alias {alias} — set at least one API key"
        )
    return CallSpec(available)


def _expand_google_keys(chain: list[Spec]) -> list[Spec]:
    """Expand each `google` spec into one per available Google free key
    so the fallback chain rotates through them on per-project 429s. No-op
    when fewer than 2 keys are configured. Mirrors expandGoogleKeys in
    src/router.ts.
    """
    n = google_key_count()
    if n <= 1:
        return chain
    out: list[Spec] = []
    for s in chain:
        if s.provider != "google":
            out.append(s)
            continue
        for i in range(n):
            out.append(Spec(s.provider, s.model, key_index=i))
    return out


def list_aliases(aliases: dict[str, list[Spec]] | None = None) -> list[dict[str, Any]]:
    table = aliases if aliases is not None else DEFAULT_ALIASES
    out = []
    for alias, chain in table.items():
        expanded = _expand_google_keys([s for s in chain if _provider_available(s.provider)])
        out.append({"alias": alias, "chain": chain, "available_count": len(expanded)})
    return out


def create_router(*, aliases: dict[str, list[Spec]] | None = None):
    """Return a (resolve, list) pair bound to a custom alias map."""
    merged = {**DEFAULT_ALIASES, **(aliases or {})}
    return (
        lambda a, **kwargs: resolve_model(a, aliases=merged, **kwargs),
        lambda: list_aliases(merged),
    )


# Re-export the type for backward compatibility.
__all__ = [
    "DEFAULT_ALIASES",
    "CallSpec",
    "Provider",
    "Spec",
    "create_router",
    "list_aliases",
    "resolve_model",
]
