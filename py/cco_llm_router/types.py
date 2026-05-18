"""Shared types — kept in a leaf module so pricing / usage / budget can
import the Provider literal without circular dependencies with router.py.

Mirrors src/types.ts in the TypeScript sibling.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

Provider = Literal[
    "anthropic",
    "google",
    "google-paid",
    "openai",
    "groq",
    "openrouter",
    "ollama",
    "deepinfra",
    "together",
]


@dataclass(frozen=True)
class Spec:
    provider: str  # one of the Provider literals; kept as str for flexibility
    model: str

    @property
    def label(self) -> str:
        return f"{self.provider}:{self.model}"
