"""Reviewed model-family metadata shared by Python routing clients."""
from __future__ import annotations

from .types import Spec

MODEL_CATALOG = (
    (Spec("dashscope", "qwen3.8-max"), "qwen", "unknown"),
    (Spec("groq", "qwen/qwen3.6-27b"), "qwen", "free"),
    (Spec("moonshot", "kimi-k3"), "kimi", "known"),
    (Spec("zai", "glm-5.3-flash"), "glm", "known"),
    (Spec("zai", "glm-5.3"), "glm", "known"),
    (Spec("ollama", "llama4:scout"), "llama", "free"),
    (Spec("minimax", "MiniMax-M2.7"), "minimax", "unknown"),
    (Spec("nvidia", "minimaxai/minimax-m2.7"), "minimax", "unknown"),
    (Spec("mistral", "mistral-large-latest"), "mistral", "unknown"),
    (Spec("nvidia", "mistralai/mistral-nemotron"), "mistral", "unknown"),
    (Spec("ollama", "gemma3:27b"), "gemma", "free"),
    (Spec("nvidia", "nvidia/nemotron-3-super-120b-a12b"), "nemotron", "unknown"),
)

_NEW_PROVIDERS = {"dashscope", "zai", "minimax", "mistral", "nvidia"}


def has_reviewed_automatic_pricing(spec: Spec) -> bool:
    match = next((row for row in MODEL_CATALOG if row[0] == spec), None)
    return match is None or match[2] != "unknown"


def requires_unknown_pricing_approval(spec: Spec) -> bool:
    match = next((row for row in MODEL_CATALOG if row[0] == spec), None)
    return (match is not None and match[2] == "unknown") or (
        match is None and spec.provider in _NEW_PROVIDERS
    )
