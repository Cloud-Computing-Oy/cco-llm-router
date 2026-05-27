"""Per-model pricing table in USD per 1M tokens (input / output).
Mirrors src/pricing.ts in the TypeScript sibling. Reference: provider
pricing pages, May 2026.

The table is intentionally incomplete — only models we actually route
to are listed. An unlisted model is priced as ZERO (free-tier / local /
OpenRouter ":free"). Add new paid models here when extending chains.
"""
from __future__ import annotations

from typing import TypedDict


class Price(TypedDict):
    input_per_m: float
    output_per_m: float


_Z: Price = {"input_per_m": 0.0, "output_per_m": 0.0}


PRICING: dict[str, Price] = {
    # --- anthropic ---
    "anthropic:claude-sonnet-4-6": {"input_per_m": 3.0, "output_per_m": 15.0},
    "anthropic:claude-haiku-4-5-20251001": {"input_per_m": 1.0, "output_per_m": 5.0},
    "anthropic:claude-opus-4-7": {"input_per_m": 15.0, "output_per_m": 75.0},

    # --- google (free tier — billed at $0 until 429) ---
    "google:gemini-2.5-flash": _Z,
    "google:gemini-2.5-pro": _Z,

    # --- google-paid ---
    "google-paid:gemini-2.5-flash": {"input_per_m": 0.075, "output_per_m": 0.3},
    "google-paid:gemini-2.5-pro": {"input_per_m": 1.25, "output_per_m": 5.0},

    # --- openai ---
    "openai:gpt-5": {"input_per_m": 3.0, "output_per_m": 15.0},
    "openai:gpt-5-mini": {"input_per_m": 0.25, "output_per_m": 2.0},
    "openai:gpt-5-nano": {"input_per_m": 0.05, "output_per_m": 0.4},

    # --- groq (free tier until rate-limited) ---
    "groq:llama-3.3-70b-versatile": _Z,
    "groq:llama-3.1-8b-instant": _Z,

    # --- deepinfra ---
    "deepinfra:meta-llama/Meta-Llama-3.1-8B-Instruct": {"input_per_m": 0.04, "output_per_m": 0.04},
    "deepinfra:meta-llama/Meta-Llama-3.3-70B-Instruct": {"input_per_m": 0.23, "output_per_m": 0.4},
    "deepinfra:meta-llama/Meta-Llama-3.3-70B-Instruct-Turbo": {"input_per_m": 0.13, "output_per_m": 0.39},
    "deepinfra:Qwen/Qwen2.5-72B-Instruct": {"input_per_m": 0.27, "output_per_m": 0.4},
    "deepinfra:deepseek-ai/DeepSeek-V3": {"input_per_m": 0.49, "output_per_m": 0.89},

    # --- together ---
    "together:meta-llama/Llama-3.3-70B-Instruct-Turbo": {"input_per_m": 0.88, "output_per_m": 0.88},
    "together:meta-llama/Llama-3.3-70B-Instruct-Lite": {"input_per_m": 0.54, "output_per_m": 0.88},
    "together:Qwen/Qwen2.5-72B-Instruct-Turbo": {"input_per_m": 1.2, "output_per_m": 1.2},
    "together:deepseek-ai/DeepSeek-V3": {"input_per_m": 1.25, "output_per_m": 1.25},

    # --- deepseek (native api.deepseek.com, V4; priced at cache-miss input) ---
    "deepseek:deepseek-v4-flash": {"input_per_m": 0.14, "output_per_m": 0.28},
    "deepseek:deepseek-v4-pro": {"input_per_m": 0.435, "output_per_m": 0.87},
}


def price_of(provider: str, model: str) -> Price:
    return PRICING.get(f"{provider}:{model}", _Z)


def estimate_cost_usd(
    provider: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
) -> float:
    p = price_of(provider, model)
    return (
        (input_tokens / 1_000_000.0) * p["input_per_m"]
        + (output_tokens / 1_000_000.0) * p["output_per_m"]
    )
