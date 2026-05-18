"""Per-provider, per-month usage tracker. Persists to a JSON file under
$XDG_STATE_HOME (or ~/.local/state). Concurrency model: best-effort —
read-modify-write per LLM round-trip. Small file, low contention.

Mirrors src/usage.ts in the TypeScript sibling — both write to the same
state directory so a host running both TS and Python services aggregates
into one view.
"""
from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .pricing import estimate_cost_usd


@dataclass
class ProviderUsage:
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    calls: int = 0


@dataclass
class MonthlyUsage:
    month: str  # YYYY-MM in UTC
    providers: dict[str, ProviderUsage] = field(default_factory=dict)


def _state_dir() -> Path:
    base = os.environ.get("XDG_STATE_HOME") or str(Path.home() / ".local" / "state")
    return Path(base) / "cco-llm-router"


def _state_path() -> Path:
    return _state_dir() / "usage.json"


def _current_month() -> str:
    d = datetime.now(timezone.utc)
    return f"{d.year:04d}-{d.month:02d}"


def _empty_state() -> MonthlyUsage:
    return MonthlyUsage(month=_current_month(), providers={})


def _load_state() -> MonthlyUsage:
    p = _state_path()
    if not p.exists():
        return _empty_state()
    try:
        raw = json.loads(p.read_text())
        if raw.get("month") != _current_month():
            return _empty_state()
        providers = {
            name: ProviderUsage(
                input_tokens=int(u.get("input_tokens", 0)),
                output_tokens=int(u.get("output_tokens", 0)),
                cost_usd=float(u.get("cost_usd", 0.0)),
                calls=int(u.get("calls", 0)),
            )
            for name, u in (raw.get("providers") or {}).items()
        }
        return MonthlyUsage(month=raw["month"], providers=providers)
    except (json.JSONDecodeError, OSError, KeyError, ValueError):
        return _empty_state()


def _save_state(s: MonthlyUsage) -> None:
    try:
        d = _state_dir()
        d.mkdir(parents=True, exist_ok=True)
        payload = {
            "month": s.month,
            "providers": {
                name: {
                    "input_tokens": u.input_tokens,
                    "output_tokens": u.output_tokens,
                    "cost_usd": u.cost_usd,
                    "calls": u.calls,
                }
                for name, u in s.providers.items()
            },
        }
        _state_path().write_text(json.dumps(payload, indent=2))
    except OSError as e:
        # Usage tracking must never break an inference call.
        print(f"[usage] failed to persist: {e}", file=sys.stderr)


def record_usage(
    provider: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
) -> None:
    if input_tokens == 0 and output_tokens == 0:
        return
    cost = estimate_cost_usd(provider, model, input_tokens, output_tokens)
    s = _load_state()
    cur = s.providers.get(provider) or ProviderUsage()
    cur.input_tokens += input_tokens
    cur.output_tokens += output_tokens
    cur.cost_usd += cost
    cur.calls += 1
    s.providers[provider] = cur
    _save_state(s)


def get_monthly_spend_usd(provider: str) -> float:
    s = _load_state()
    u = s.providers.get(provider)
    return u.cost_usd if u else 0.0


def get_current_month_spend() -> dict[str, Any]:
    s = _load_state()
    total = sum(u.cost_usd for u in s.providers.values())
    return {
        "month": s.month,
        "total_usd": total,
        "per_provider": {
            name: {
                "input_tokens": u.input_tokens,
                "output_tokens": u.output_tokens,
                "cost_usd": u.cost_usd,
                "calls": u.calls,
            }
            for name, u in s.providers.items()
        },
    }


def reset_usage() -> None:
    _save_state(_empty_state())
