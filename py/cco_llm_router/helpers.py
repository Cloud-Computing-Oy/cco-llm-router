"""Convenience wrappers — `chat()` / `chat_json()` over the router."""
from __future__ import annotations

import json
import re
from typing import Any

from .router import resolve_model


def chat(
    *,
    system: str,
    prompt: str,
    alias: str = "auto:smart",
    temperature: float | None = None,
    max_tokens: int | None = None,
    data_class: str = "internal",
    allow_pilot: bool = False,
    bypass_budget: bool = False,
) -> str:
    """Resolve `alias`, walk the available chain, return the text."""
    callspec = resolve_model(
        alias,
        data_class=data_class,
        allow_pilot=allow_pilot,
        bypass_budget=bypass_budget,
    )
    return callspec.call(
        system=system,
        prompt=prompt,
        temperature=temperature,
        max_tokens=max_tokens,
    )


_JSON_FENCE = re.compile(r"^```(?:json)?\s*([\s\S]*?)```$")


def chat_json(
    *,
    system: str,
    prompt: str,
    alias: str = "auto:smart",
    temperature: float | None = None,
    max_tokens: int | None = None,
    data_class: str = "internal",
    allow_pilot: bool = False,
    bypass_budget: bool = False,
) -> Any | None:
    """Same as chat() but expects JSON. Strips ```json fences if present;
    returns None on parse failure rather than raising."""
    raw = chat(
        system=system,
        prompt=prompt,
        alias=alias,
        temperature=temperature,
        max_tokens=max_tokens,
        data_class=data_class,
        allow_pilot=allow_pilot,
        bypass_budget=bypass_budget,
    )
    cleaned = raw.strip()
    m = _JSON_FENCE.match(cleaned)
    if m:
        cleaned = m.group(1).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return None
