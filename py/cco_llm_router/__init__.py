"""Python sibling of @cloud-computing-oy/llm-router.

Mirrors the Node package's API:
  resolve_model(alias) -> CallSpec
    .call(system, prompt, *, temperature, max_tokens) -> str
  chat(system, prompt, *, alias=None, ...) -> str
  chat_json(system, prompt, *, alias=None, ...) -> Any | None
  rerank(query, documents, *, top_n=None, model='rerank-v4.0-pro')

Same default aliases (auto:smart / fast / translate / code / reasoning /
paid / big / local / cheap), same env-var precedence for provider keys.

Cost-optimised: free providers lead, DeepInfra slots in as the
ultra-cheap paid fallback before expensive tiers. Per-provider monthly
budget enforcement via CCO_LLM_BUDGET_<PROVIDER>_USD env vars; usage
state is persisted at $XDG_STATE_HOME/cco-llm-router/usage.json (shared
file format with the TS sibling).

Provider SDKs are declared as optional extras; install with e.g.
`pip install 'cco-llm-router[all]'` for everything, or pin a subset.
"""

from .automatic_routing import select_automatic_alias
from .budget import get_budget_usd, within_budget
from .helpers import chat, chat_json
from .pricing import PRICING, Price, estimate_cost_usd, price_of
from .router import (
    DEFAULT_ALIASES,
    CallSpec,
    create_router,
    list_aliases,
    resolve_model,
)
from .types import Provider, Spec
from .usage import (
    get_current_month_spend,
    get_monthly_spend_usd,
    record_usage,
    reset_usage,
)

__all__ = [
    "DEFAULT_ALIASES",
    "PRICING",
    "CallSpec",
    "Price",
    "Provider",
    "Spec",
    "chat",
    "chat_json",
    "create_router",
    "estimate_cost_usd",
    "get_budget_usd",
    "get_current_month_spend",
    "get_monthly_spend_usd",
    "list_aliases",
    "price_of",
    "record_usage",
    "reset_usage",
    "resolve_model",
    "select_automatic_alias",
    "within_budget",
]

__version__ = "0.6.0"
