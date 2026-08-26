from __future__ import annotations

import os

import httpx

from ..ollama_gate import ollama_lease, request_timeout_seconds


def call(spec, *, system, prompt, temperature, max_tokens):
    """Returns (text, usage_dict). Local compute → cost is zero, but we
    still report token counts so consumers can see throughput."""
    base = os.environ.get("OLLAMA_BASE_URL")
    if not base:
        raise RuntimeError("OLLAMA_BASE_URL not set")
    options: dict = {}
    if temperature is not None:
        options["temperature"] = temperature
    if max_tokens:
        options["num_predict"] = max_tokens
    with ollama_lease(), httpx.Client(timeout=request_timeout_seconds()) as client:
        resp = client.post(
            f"{base.rstrip('/')}/api/chat",
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
        text = (data.get("message", {}).get("content", "") or "").strip()
        usage = {
            "input_tokens": int(data.get("prompt_eval_count", 0) or 0),
            "output_tokens": int(data.get("eval_count", 0) or 0),
        }
        return text, usage
