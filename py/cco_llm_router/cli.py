"""cco-llm-usage — print current month's per-provider spend.

  $ cco-llm-usage

Exits 1 if any provider is over its budget cap. Useful for cron alerts.
Mirrors the TypeScript CLI in src/bin/usage.ts.
"""
from __future__ import annotations

import sys

from .budget import get_budget_usd
from .usage import get_current_month_spend

_PROVIDERS = [
    "anthropic",
    "openai",
    "google",
    "google-paid",
    "groq",
    "openrouter",
    "ollama",
    "deepinfra",
    "together",
]


def _fmt_usd(n: float) -> str:
    return f"${n:.2f}"


def _fmt_int(n: int) -> str:
    return f"{n:,}"


def main() -> int:
    state = get_current_month_spend()
    month = state["month"]
    total = state["total_usd"]
    per = state["per_provider"]

    print(f"Month: {month}  Total: {_fmt_usd(total)}\n")
    print(
        f"{'provider':<14}{'calls':>8}{'in_tokens':>14}{'out_tokens':>14}"
        f"{'cost':>10}{'budget':>10}{'used':>8}"
    )
    print("─" * 78)

    total_budget = 0.0
    over_budget = False
    for prov in _PROVIDERS:
        u = per.get(prov)
        cap = get_budget_usd(prov)
        total_budget += cap
        if not u and cap == 0:
            continue
        spent = u["cost_usd"] if u else 0.0
        pct = round((spent / cap) * 100) if cap > 0 else 0
        if cap > 0 and spent >= cap:
            over_budget = True
        calls = u["calls"] if u else 0
        in_t = u["input_tokens"] if u else 0
        out_t = u["output_tokens"] if u else 0
        print(
            f"{prov:<14}{_fmt_int(calls):>8}{_fmt_int(in_t):>14}{_fmt_int(out_t):>14}"
            f"{_fmt_usd(spent):>10}{(_fmt_usd(cap) if cap > 0 else '-'):>10}"
            f"{(f'{pct}%' if cap > 0 else '-'):>8}"
        )

    print("─" * 78)
    tail = (
        f"Used: {_fmt_usd(total)}"
        + (f" / {_fmt_usd(total_budget)}" if total_budget > 0 else "")
    )
    print(" " * 60 + tail)

    return 1 if over_budget else 0


if __name__ == "__main__":
    sys.exit(main())
