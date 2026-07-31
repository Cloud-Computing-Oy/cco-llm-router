"""Provider call dispatch.

Each provider lives in its own submodule and exports a
`call(spec, system, prompt, *, temperature, max_tokens) -> (text, usage)`
where `usage` is `{"input_tokens": int, "output_tokens": int} | None`.
The dispatcher here picks the right module based on `spec.provider`.

Classifies certain provider errors as TransientError so the router can
fall through to the next chain entry instead of failing the whole call.
"""
from __future__ import annotations

import re


class TransientError(RuntimeError):
    """Raised when the provider hit a quota / rate / temporary-failure
    condition. The router treats this as a signal to fall through to
    the next provider in the chain."""


_FALLBACK_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in [
        r"invalid.*api.?key",
        r"unauthor",
        r"\b401\b",
        r"\b403\b",
        r"rate.?limit",
        r"quota",
        r"\b429\b",
        r"model.*not.*found",
        r"\b404\b",
        r"service unavailable",
        r"\b503\b",
        r"decommissioned",
        r"no longer supported",
        r"deprecated",
        r"context.*length",
        r"timeout",
        r"connection.*reset",
        r"connection.*refused",
        r"insufficient.*quota",
        r"payment.*required",
        r"\b402\b",
    ]
]


def is_transient(exc: BaseException) -> bool:
    msg = str(exc)
    return any(p.search(msg) for p in _FALLBACK_PATTERNS)


def call(spec, *, system: str, prompt: str, temperature, max_tokens):
    """Returns (text, usage_dict). Raises TransientError on fall-through
    conditions, propagates other exceptions as-is."""
    try:
        match spec.provider:
            case "anthropic":
                from . import anthropic as p
            case "google" | "google-paid":
                from . import google as p
            case "openai" | "groq" | "openrouter" | "deepinfra" | "together" | "deepseek" | "moonshot":
                from . import openai_compat as p
            case "ollama":
                from . import ollama as p
            case _:
                raise RuntimeError(f"Unknown provider: {spec.provider}")
        return p.call(
            spec,
            system=system,
            prompt=prompt,
            temperature=temperature,
            max_tokens=max_tokens,
        )
    except TransientError:
        raise
    except Exception as e:
        if is_transient(e):
            raise TransientError(str(e)) from e
        raise
