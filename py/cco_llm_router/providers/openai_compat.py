"""OpenAI-compatible providers: openai, groq, openrouter, deepinfra,
together all speak the same /v1/chat/completions protocol at different
base URLs."""
from __future__ import annotations

import os


_BASE_URL = {
    "openai": None,  # default
    "groq": "https://api.groq.com/openai/v1",
    "openrouter": "https://openrouter.ai/api/v1",
    "deepinfra": "https://api.deepinfra.com/v1/openai",
    "together": "https://api.together.xyz/v1",
}

_KEY_ENV = {
    "openai": "OPENAI_API_KEY",
    "groq": "GROQ_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
    "deepinfra": "DEEPINFRA_API_KEY",
    "together": "TOGETHER_API_KEY",
}


def call(spec, *, system, prompt, temperature, max_tokens):
    """Returns (text, usage_dict) — usage_dict has {input_tokens, output_tokens}."""
    try:
        from openai import OpenAI
    except ImportError as e:
        raise ImportError(
            "openai SDK not installed — `pip install cco-llm-router[openai]`"
        ) from e
    key = os.environ.get(_KEY_ENV[spec.provider])
    if not key:
        raise RuntimeError(f"No API key for {spec.provider}")
    client = OpenAI(
        api_key=key,
        base_url=_BASE_URL.get(spec.provider),
    )
    resp = client.chat.completions.create(
        model=spec.model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        temperature=temperature if temperature is not None else 0.7,
        max_tokens=max_tokens,
    )
    text = (resp.choices[0].message.content or "").strip()
    usage = None
    if resp.usage is not None:
        usage = {
            "input_tokens": int(getattr(resp.usage, "prompt_tokens", 0) or 0),
            "output_tokens": int(getattr(resp.usage, "completion_tokens", 0) or 0),
        }
    return text, usage
