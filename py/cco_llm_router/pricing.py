"""Per-model pricing table in USD per 1M tokens (input / output).
Mirrors src/pricing.ts in the TypeScript sibling. Reference: provider
pricing pages, updated September 2026.

The table is intentionally incomplete — only models we actually route
to are listed. An unlisted model is priced as ZERO (free-tier / local /
OpenRouter ":free"). Add new paid models here when extending chains.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import NotRequired, TypedDict


class PeakRates(TypedDict):
    input_per_m: float
    output_per_m: float


class Price(TypedDict):
    input_per_m: float
    output_per_m: float
    # Peak-hour rates for providers that charge more at defined hours; the
    # top-level fields are then the off-peak rates. Only effective_price()
    # and estimate_cost_usd() are time-aware.
    peak: NotRequired[PeakRates]


_Z: Price = {"input_per_m": 0.0, "output_per_m": 0.0}

# Provider peak windows in UTC, weekdays only. Half-open [start, end) in whole
# hours. DeepSeek charges double during peak; off-peak is the list price.
# Source: DeepSeek pricing docs, effective 2026-09-10.
_PEAK_WINDOWS_UTC: dict[str, tuple[tuple[int, int], ...]] = {
    "deepseek": ((1, 4), (6, 10)),
}


def _is_peak_hour(provider: str, at: datetime) -> bool:
    windows = _PEAK_WINDOWS_UTC.get(provider)
    if not windows:
        return False
    if at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)  # naive timestamps are UTC
    at = at.astimezone(timezone.utc)
    if at.weekday() >= 5:  # Saturday = 5, Sunday = 6
        return False
    return any(start <= at.hour < end for start, end in windows)


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
    "groq:qwen/qwen3.6-27b": _Z,

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

    # --- deepseek (native api.deepseek.com) ---
    # V4.1 Flash list price (2026-09-10): $0.15 / $0.6 off-peak, $0.3 / $1.2
    # peak. Priced at cache-MISS input: no cache-hit accounting exists, so this
    # over-estimates spend (safe for the budget net). All three ids are served
    # by V4.1 Flash — `deepseek-v4-flash` redirects, `deepseek-v4-pro` starts
    # redirecting 2026-09-14.
    "deepseek:deepseek-flash": {
        "input_per_m": 0.15,
        "output_per_m": 0.6,
        "peak": {"input_per_m": 0.3, "output_per_m": 1.2},
    },
    "deepseek:deepseek-v4-flash": {
        "input_per_m": 0.15,
        "output_per_m": 0.6,
        "peak": {"input_per_m": 0.3, "output_per_m": 1.2},
    },
    "deepseek:deepseek-v4-pro": {
        "input_per_m": 0.15,
        "output_per_m": 0.6,
        "peak": {"input_per_m": 0.3, "output_per_m": 1.2},
    },

    # --- moonshot (Kimi Platform; conservative cache-miss input price) ---
    "moonshot:kimi-k3": {"input_per_m": 3.0, "output_per_m": 15.0},

    # --- Z.ai (permanent list price; do not encode temporary discounts) ---
    "zai:glm-5.3-flash": {"input_per_m": 0.15, "output_per_m": 0.5},
    "zai:glm-5.3": {"input_per_m": 1.4, "output_per_m": 4.4},
}


def price_of(provider: str, model: str) -> Price:
    return PRICING.get(f"{provider}:{model}", _Z)


def effective_price(provider: str, model: str, at: datetime | None = None) -> dict[str, float]:
    """Rates in effect at `at` (default: now). Falls back to the list price
    outside peak windows and for providers without peak pricing."""
    base = price_of(provider, model)
    ts = at if at is not None else datetime.now(timezone.utc)
    rates = base["peak"] if ("peak" in base and _is_peak_hour(provider, ts)) else base
    return {"input_per_m": rates["input_per_m"], "output_per_m": rates["output_per_m"]}


def estimate_cost_usd(
    provider: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    at: datetime | None = None,
) -> float:
    p = effective_price(provider, model, at)
    return (
        (input_tokens / 1_000_000.0) * p["input_per_m"]
        + (output_tokens / 1_000_000.0) * p["output_per_m"]
    )
