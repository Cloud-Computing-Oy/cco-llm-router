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
    # Meaningful only for the Google free provider: when the env has
    # multiple keys (GOOGLE_GENERATIVE_AI_API_KEY + _2/_3/…), the router
    # expands each `google:` spec into N copies with rising key_index,
    # so the fallback chain rotates through them on per-project 429s
    # before falling through to the next provider.
    key_index: int = 0

    @property
    def label(self) -> str:
        tag = f"#{self.key_index}" if self.provider == "google" and self.key_index > 0 else ""
        return f"{self.provider}:{self.model}{tag}"
