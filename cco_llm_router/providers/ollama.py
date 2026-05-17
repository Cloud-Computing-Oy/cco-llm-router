from __future__ import annotations

import os

import httpx


def call(spec, *, system, prompt, temperature, max_tokens) -> str:
    base = os.environ.get("OLLAMA_BASE_URL")
    if not base:
        raise RuntimeError("OLLAMA_BASE_URL not set")
    options: dict = {}
    if temperature is not None:
        options["temperature"] = temperature
    if max_tokens:
        options["num_predict"] = max_tokens
    with httpx.Client(timeout=120) as client:
        resp = client.post(
            f"{base}/api/chat",
            json={
                "model": spec.model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt},
                ],
                "stream": False,
                "options": options,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return (data.get("message", {}).get("content", "") or "").strip()
