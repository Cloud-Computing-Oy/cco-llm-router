"""Cohere Rerank wrapper (separate API surface from chat)."""
from __future__ import annotations

import os
from dataclasses import dataclass

import httpx

_COHERE_API = "https://api.cohere.com/v2"


@dataclass(frozen=True)
class RerankResult:
    index: int
    relevance_score: float


def rerank(
    *,
    query: str,
    documents: list[str],
    top_n: int | None = None,
    model: str = "rerank-v4.0-pro",
) -> list[RerankResult]:
    """Reorder `documents` by relevance to `query` using Cohere's rerank
    endpoint. Returns `[(index, score), ...]` sorted by score desc."""
    if not documents:
        return []
    key = os.environ.get("COHERE_API_KEY")
    if not key:
        raise RuntimeError("COHERE_API_KEY not set")
    payload = {
        "model": model,
        "query": query,
        "documents": documents,
        "top_n": top_n or len(documents),
    }
    with httpx.Client(timeout=60) as client:
        resp = client.post(
            f"{_COHERE_API}/rerank",
            headers={
                "authorization": f"Bearer {key}",
                "content-type": "application/json",
            },
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()
    return [
        RerankResult(index=r["index"], relevance_score=r["relevance_score"])
        for r in data.get("results", [])
    ]
