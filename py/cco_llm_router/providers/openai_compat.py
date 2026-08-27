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
    "deepseek": "https://api.deepseek.com",
    "moonshot": os.environ.get("MOONSHOT_BASE_URL", "https://api.moonshot.ai/v1"),
    "dashscope": os.environ.get(
        "DASHSCOPE_BASE_URL", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
    ),
    "zai": os.environ.get("ZAI_BASE_URL", "https://api.z.ai/api/paas/v4"),
    "minimax": os.environ.get("MINIMAX_BASE_URL", "https://api.minimax.io/v1"),
    "mistral": os.environ.get("MISTRAL_BASE_URL", "https://api.mistral.ai/v1"),
    "nvidia": os.environ.get("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1"),
}

_KEY_ENV = {
    "openai": "OPENAI_API_KEY",
    "groq": "GROQ_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
    "deepinfra": "DEEPINFRA_API_KEY",
    "together": "TOGETHER_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
    "moonshot": "MOONSHOT_API_KEY",
    "dashscope": "DASHSCOPE_API_KEY",
    "zai": "ZAI_API_KEY",
    "minimax": "MINIMAX_API_KEY",
    "mistral": "MISTRAL_API_KEY",
    "nvidia": "NVIDIA_API_KEY",
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
