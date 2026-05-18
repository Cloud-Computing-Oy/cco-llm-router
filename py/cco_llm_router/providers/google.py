from __future__ import annotations

import os


def call(spec, *, system, prompt, temperature, max_tokens):
    """Returns (text, usage_dict)."""
    try:
        from google import genai
        from google.genai import types
    except ImportError as e:
        raise ImportError(
            "google-genai SDK not installed — `pip install cco-llm-router[google]`"
        ) from e
    key = (
        os.environ.get("GOOGLE_GENERATIVE_AI_API_KEY_PAID")
        if spec.provider == "google-paid"
        else os.environ.get("GOOGLE_GENERATIVE_AI_API_KEY")
        or os.environ.get("GOOGLE_GENAI_API_KEY")
        or os.environ.get("GEMINI_API_KEY")
    )
    if not key:
        raise RuntimeError(f"No API key for {spec.provider}")
    client = genai.Client(api_key=key)
    config = types.GenerateContentConfig(
        system_instruction=system,
        temperature=temperature if temperature is not None else 0.7,
        max_output_tokens=max_tokens,
    )
    resp = client.models.generate_content(
        model=spec.model,
        contents=prompt,
        config=config,
    )
    text = (resp.text or "").strip()
    usage = None
    meta = getattr(resp, "usage_metadata", None)
    if meta is not None:
        usage = {
            "input_tokens": int(getattr(meta, "prompt_token_count", 0) or 0),
            "output_tokens": int(getattr(meta, "candidates_token_count", 0) or 0),
        }
    return text, usage
