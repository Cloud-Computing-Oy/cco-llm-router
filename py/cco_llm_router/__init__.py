"""Python sibling of @cloud-computing-oy/llm-router.

Mirrors the Node package's API:
  resolve_model(alias) -> { "spec": Spec, "specs": [Spec], "call": callable }
  chat(system, prompt, *, alias='auto:smart', ...) -> str
  chat_json(system, prompt, *, alias='auto:smart', ...) -> Any | None
  rerank(query, documents, *, top_n=None, model='rerank-v4.0-pro')

Same default aliases (auto:smart / fast / translate / code / reasoning /
paid / big / local / cheap), same env-var precedence for provider keys.

Provider SDKs are declared as optional extras; install with e.g.
`pip install 'cco-llm-router[all]'` for everything, or pin a subset.
"""

from .router import (
    DEFAULT_ALIASES,
    Spec,
    create_router,
    list_aliases,
    resolve_model,
)
from .helpers import chat, chat_json

__all__ = [
    "DEFAULT_ALIASES",
    "Spec",
    "chat",
    "chat_json",
    "create_router",
    "list_aliases",
    "resolve_model",
]

__version__ = "0.1.0"
