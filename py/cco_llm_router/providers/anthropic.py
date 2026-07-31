from __future__ import annotations

import os


def call(spec, *, system, prompt, temperature, max_tokens):
    """Returns (text, usage_dict)."""
    try:
        from anthropic import Anthropic
    except ImportError as e:
        raise ImportError(
            "anthropic SDK not installed — `pip install cco-llm-router[anthropic]`"
        ) from e
    client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    resp = client.messages.create(
        model=spec.model,
        system=system,
        max_tokens=max_tokens or 1024,
        temperature=temperature if temperature is not None else 0.7,
        messages=[{"role": "user", "content": prompt}],
    )
    parts = [b.text for b in resp.content if getattr(b, "type", "") == "text"]
    text = "".join(parts).strip()
    usage = None
    if resp.usage is not None:
        usage = {
            "input_tokens": int(getattr(resp.usage, "input_tokens", 0) or 0),
            "output_tokens": int(getattr(resp.usage, "output_tokens", 0) or 0),
        }
    return text, usage
