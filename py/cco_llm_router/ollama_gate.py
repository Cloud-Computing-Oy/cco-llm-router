"""Runtime guard for an intermittent laptop-hosted Ollama worker."""
from __future__ import annotations

import os
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager

import httpx

_lock = threading.Lock()
_active = 0
_circuit_open_until = 0.0
_last_health_at = 0.0
_last_health_ok = False
_last_health_model = ""


def _int_env(name: str, default: int, minimum: int) -> int:
    try:
        return max(minimum, int(os.environ.get(name, default)))
    except ValueError:
        return default


def request_timeout_seconds() -> float:
    return _int_env("CCO_LLM_OLLAMA_REQUEST_TIMEOUT_MS", 120_000, 1_000) / 1000


def _healthy(required_model: str | None = None) -> bool:
    global _last_health_at, _last_health_ok, _last_health_model
    now = time.monotonic()
    cache_seconds = _int_env("CCO_LLM_OLLAMA_HEALTH_CACHE_MS", 5_000, 0) / 1000
    with _lock:
        if now - _last_health_at <= cache_seconds and _last_health_model == (required_model or ""):
            return _last_health_ok

    base = os.environ.get("OLLAMA_BASE_URL", "").rstrip("/")
    if not base:
        return False
    timeout = _int_env("CCO_LLM_OLLAMA_HEALTH_TIMEOUT_MS", 1_500, 100) / 1000
    try:
        response = httpx.get(f"{base}/api/tags", timeout=timeout)
        ok = response.is_success
        if ok and required_model:
            models = response.json().get("models", [])
            ok = any(
                model.get("name") == required_model or model.get("model") == required_model
                for model in models
            )
    except (httpx.HTTPError, ValueError):
        ok = False
    with _lock:
        _last_health_at = time.monotonic()
        _last_health_ok = ok
        _last_health_model = required_model or ""
    return ok


@contextmanager
def ollama_lease(required_model: str | None = None) -> Iterator[None]:
    """Fail fast when the worker is offline, circuit-open, or already busy."""
    global _active, _circuit_open_until
    now = time.monotonic()
    with _lock:
        if now < _circuit_open_until:
            raise RuntimeError("Ollama circuit open")
        maximum = _int_env("CCO_LLM_OLLAMA_MAX_CONCURRENT", 1, 1)
        if _active >= maximum:
            raise RuntimeError("Ollama worker busy")

    if not _healthy(required_model):
        with _lock:
            _circuit_open_until = time.monotonic() + (
                _int_env("CCO_LLM_OLLAMA_CIRCUIT_OPEN_MS", 60_000, 1_000) / 1000
            )
        raise RuntimeError("Ollama health check failed")

    with _lock:
        # Another thread may have acquired the worker during the health probe.
        maximum = _int_env("CCO_LLM_OLLAMA_MAX_CONCURRENT", 1, 1)
        if _active >= maximum:
            raise RuntimeError("Ollama worker busy")
        _active += 1
    try:
        yield
        with _lock:
            _circuit_open_until = 0.0
    except Exception:
        with _lock:
            _circuit_open_until = time.monotonic() + (
                _int_env("CCO_LLM_OLLAMA_CIRCUIT_OPEN_MS", 60_000, 1_000) / 1000
            )
        raise
    finally:
        with _lock:
            _active = max(0, _active - 1)


def _reset_for_tests() -> None:
    global _active, _circuit_open_until, _last_health_at, _last_health_ok, _last_health_model
    with _lock:
        _active = 0
        _circuit_open_until = 0.0
        _last_health_at = 0.0
        _last_health_ok = False
        _last_health_model = ""
