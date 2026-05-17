"""Provider-aware routing with fallback chains.

Mirrors the TypeScript router in @cloud-computing-oy/llm-router but
implemented natively with provider SDKs (anthropic, google-genai,
openai/groq/openrouter via OpenAI-compatible API, ollama via httpx).

Each alias resolves to a Spec list filtered by `available` and a
`call_chain` callable that walks the list, falling through on
classified-as-transient errors (quota / 429 / 401 / 5xx / network).
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Callable, Iterable

from . import providers


@dataclass(frozen=True)
class Spec:
    provider: str
    model: str

    @property
    def label(self) -> str:
        return f"{self.provider}:{self.model}"


# Same chains as the Node package — cost-first wherever quality allows.
# Cost reference (input / output per M tokens, May 2026):
#   ollama:*                     free (compute amortised)
#   groq:llama-3.3-70b           free (rate-limited)
#   openrouter:*:free            free (small daily cap per account)
#   google:gemini-2.5-flash      free tier — 1500 RPD per GCP project
#   google-paid:gemini-2.5-flash $0.075 / $0.30
#   google-paid:gemini-2.5-pro   $1.25  / $5.00
#   anthropic:claude-sonnet-4-6  $3 / $15
#   anthropic:claude-haiku-4-5   $1 / $5
#   openai:gpt-5-mini            ~$0.25 / $2
#   openai:gpt-5                 ~$3   / $15
DEFAULT_ALIASES: dict[str, list[Spec]] = {
    "auto:smart": [
        Spec("google", "gemini-2.5-flash"),
        Spec("openrouter", "qwen/qwen3-next-80b-a3b-instruct:free"),
        Spec("openrouter", "nvidia/nemotron-3-super-120b-a12b:free"),
        Spec("google-paid", "gemini-2.5-flash"),
        Spec("google", "gemini-2.5-pro"),
        Spec("google-paid", "gemini-2.5-pro"),
        Spec("anthropic", "claude-sonnet-4-6"),
        Spec("openai", "gpt-5"),
        Spec("ollama", "qwen2.5-coder:14b"),
    ],
    "auto:fast": [
        Spec("groq", "llama-3.3-70b-versatile"),
        Spec("google", "gemini-2.5-flash"),
        Spec("openrouter", "nvidia/nemotron-3-nano-30b-a3b:free"),
        Spec("openrouter", "minimax/minimax-m2.5:free"),
        Spec("google-paid", "gemini-2.5-flash"),
        Spec("openai", "gpt-5-mini"),
        Spec("anthropic", "claude-haiku-4-5-20251001"),
        Spec("ollama", "gemma4:e4b"),
    ],
    "auto:translate": [
        Spec("ollama", "gemma4:26b"),
        Spec("google", "gemini-2.5-flash"),
        Spec("google-paid", "gemini-2.5-flash"),
        Spec("anthropic", "claude-sonnet-4-6"),
    ],
    "auto:code": [
        Spec("google", "gemini-2.5-flash"),
        Spec("openrouter", "qwen/qwen3-coder:free"),
        Spec("groq", "llama-3.3-70b-versatile"),
        Spec("google-paid", "gemini-2.5-flash"),
        Spec("openai", "gpt-5-mini"),
        Spec("ollama", "qwen2.5-coder:14b"),
    ],
    "auto:reasoning": [
        Spec("google", "gemini-2.5-pro"),
        Spec("google-paid", "gemini-2.5-pro"),
        Spec("openrouter", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free"),
        Spec("openrouter", "arcee-ai/trinity-large-thinking:free"),
        Spec("anthropic", "claude-sonnet-4-6"),
        Spec("openai", "gpt-5"),
    ],
    "auto:paid": [
        Spec("openai", "gpt-5"),
        Spec("openai", "gpt-5-mini"),
        Spec("anthropic", "claude-sonnet-4-6"),
        Spec("google-paid", "gemini-2.5-pro"),
    ],
    "auto:big": [
        Spec("openrouter", "google/gemma-4-31b-it:free"),
        Spec("openrouter", "google/gemma-4-26b-a4b-it:free"),
        Spec("google", "gemini-2.5-pro"),
        Spec("google-paid", "gemini-2.5-pro"),
        Spec("openai", "gpt-5"),
        Spec("ollama", "gemma4:26b"),
    ],
    "auto:local": [
        Spec("ollama", "qwen2.5-coder:14b"),
        Spec("ollama", "gemma4:e4b"),
    ],
    "auto:cheap": [
        Spec("ollama", "gemma4:e4b"),
        Spec("openrouter", "minimax/minimax-m2.5:free"),
        Spec("groq", "llama-3.3-70b-versatile"),
        Spec("google", "gemini-2.5-flash"),
        Spec("google-paid", "gemini-2.5-flash"),
        Spec("openai", "gpt-5-mini"),
    ],
}


_PROVIDER_AVAILABLE: dict[str, Callable[[], bool]] = {
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
}


class CallSpec:
    """A resolved (alias-or-direct) spec list with a ready-to-call callable.

    `call(system, prompt, **kwargs)` walks the available chain, falling
    through to the next provider on transient errors. Raises after the
    entire chain fails.
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
        for spec in self.specs:
            try:
                return providers.call(
                    spec,
                    system=system,
                    prompt=prompt,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
            except providers.TransientError as e:
                print(f"[fallback] {spec.label} failed: {e} — trying next")
                last_err = e
                continue
            except Exception as e:
                # Non-transient — fail loudly so callers can surface it.
                raise
        raise RuntimeError(
            f"All providers failed for chain [{', '.join(s.label for s in self.specs)}]: {last_err}"
        )


def _provider_available(name: str) -> bool:
    fn = _PROVIDER_AVAILABLE.get(name)
    return bool(fn and fn())


def resolve_model(alias: str, *, aliases: dict[str, list[Spec]] | None = None) -> CallSpec:
    """Resolve an alias to a CallSpec with the available subset of the chain.

    Pass `alias` as either:
      - A registered alias like "auto:smart"
      - A direct "provider:model" string (e.g. "anthropic:claude-sonnet-4-6")
    """
    if ":" in alias and not alias.startswith("auto:"):
        provider, _, model = alias.partition(":")
        if not _provider_available(provider):
            raise RuntimeError(f"Provider not available: {provider} (missing key?)")
        return CallSpec([Spec(provider, model)])

    table = aliases if aliases is not None else DEFAULT_ALIASES
    chain = table.get(alias)
    if chain is None:
        raise RuntimeError(f"Unknown model alias: {alias}")

    available = [s for s in chain if _provider_available(s.provider)]
    if not available:
        raise RuntimeError(f"No available provider for alias {alias} — set at least one API key")
    return CallSpec(available)


def list_aliases(aliases: dict[str, list[Spec]] | None = None) -> list[dict[str, Any]]:
    table = aliases if aliases is not None else DEFAULT_ALIASES
    return [
        {
            "alias": alias,
            "chain": chain,
            "available_count": sum(1 for s in chain if _provider_available(s.provider)),
        }
        for alias, chain in table.items()
    ]


def create_router(*, aliases: dict[str, list[Spec]] | None = None):
    """Return a (resolve, list) pair bound to a custom alias map."""
    merged = {**DEFAULT_ALIASES, **(aliases or {})}
    return (
        lambda a: resolve_model(a, aliases=merged),
        lambda: list_aliases(merged),
    )
