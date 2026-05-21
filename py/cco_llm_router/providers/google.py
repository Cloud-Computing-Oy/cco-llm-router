from __future__ import annotations

import os


def _collect_free_keys() -> list[str]:
    """Read the Google free pool: primary slot + GOOGLE_GENERATIVE_AI_API_KEY_2..N.

    Scans until the first gap. Mirrors the TS sibling in src/providers/google.ts.
    """
    keys: list[str] = []
    primary = (
        os.environ.get("GOOGLE_GENERATIVE_AI_API_KEY")
        or os.environ.get("GOOGLE_GENAI_API_KEY")
        or os.environ.get("GEMINI_API_KEY")
    )
    if primary:
        keys.append(primary)
    i = 2
    while True:
        k = os.environ.get(f"GOOGLE_GENERATIVE_AI_API_KEY_{i}")
        if not k:
            break
        keys.append(k)
        i += 1
    return keys


def _free_key(index: int) -> str | None:
    keys = _collect_free_keys()
    if 0 <= index < len(keys):
        return keys[index]
    return None


def google_key_count() -> int:
    """How many Google free keys are configured. Used by the router to
    expand `google:` specs into one per key."""
    return len(_collect_free_keys())


def call(spec, *, system, prompt, temperature, max_tokens):
    """Returns (text, usage_dict)."""
    try:
        from google import genai
        from google.genai import types
    except ImportError as e:
        raise ImportError(
            "google-genai SDK not installed — `pip install cco-llm-router[google]`"
        ) from e
    if spec.provider == "google-paid":
        key = os.environ.get("GOOGLE_GENERATIVE_AI_API_KEY_PAID")
    else:
        key = _free_key(spec.key_index)
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
