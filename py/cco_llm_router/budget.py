"""Per-provider monthly budget enforcement.

Reads CCO_LLM_BUDGET_<PROVIDER>_USD env vars and compares against the
local usage tracker. When local spend exceeds 90% of the cap, the router
pre-flight-skips that provider for new requests — falling through to
the next candidate in the chain.

The provider's dashboard hard cap remains the primary control; this is
a safety net so a single request can't burst past the budget while the
chain is being resolved. Setting a cap to 0 (or omitting the env var)
leaves the provider unrestricted by the router.
"""
from __future__ import annotations

import os

from .usage import get_monthly_spend_usd

_SAFETY_MARGIN = 0.9

_ENV_KEY: dict[str, str] = {
    "anthropic": "CCO_LLM_BUDGET_ANTHROPIC_USD",
    "google": "CCO_LLM_BUDGET_GOOGLE_USD",
    "google-paid": "CCO_LLM_BUDGET_GOOGLE_PAID_USD",
    "openai": "CCO_LLM_BUDGET_OPENAI_USD",
    "groq": "CCO_LLM_BUDGET_GROQ_USD",
    "openrouter": "CCO_LLM_BUDGET_OPENROUTER_USD",
    "ollama": "CCO_LLM_BUDGET_OLLAMA_USD",
    "deepinfra": "CCO_LLM_BUDGET_DEEPINFRA_USD",
    "together": "CCO_LLM_BUDGET_TOGETHER_USD",
    "deepseek": "CCO_LLM_BUDGET_DEEPSEEK_USD",
}


def get_budget_usd(provider: str) -> float:
    env_name = _ENV_KEY.get(provider)
    if not env_name:
        return 0.0
    raw = os.environ.get(env_name)
    if not raw:
        return 0.0
    try:
        n = float(raw)
    except ValueError:
        return 0.0
    return n if n > 0 else 0.0


def within_budget(provider: str) -> bool:
    cap = get_budget_usd(provider)
    if cap == 0:
        return True
    return get_monthly_spend_usd(provider) < cap * _SAFETY_MARGIN
