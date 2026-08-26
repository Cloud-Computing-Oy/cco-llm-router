"""Runtime guard for an intermittent laptop-hosted Ollama worker."""
from __future__ import annotations

import os
import threading
import time
from contextlib import contextmanager
from collections.abc import Iterator

import httpx

_lock = threading.Lock()
_active = 0
_circuit_open_until = 0.0
_last_health_at = 0.0
_last_health_ok = False


def _int_env(name: str, default: int, minimum: int) -> int:
    try:
        return max(minimum, int(os.environ.get(name, default)))
    except ValueError:
        return default


def request_timeout_seconds() -> float:
    return _int_env("CCO_LLM_OLLAMA_REQUEST_TIMEOUT_MS", 120_000, 1_000) / 1000


def _healthy() -> bool:
    global _last_health_at, _last_health_ok
    now = time.monotonic()
    cache_seconds = _int_env("CCO_LLM_OLLAMA_HEALTH_CACHE_MS", 5_000, 0) / 1000
    with _lock:
        if now - _last_health_at <= cache_seconds:
            return _last_health_ok

    base = os.environ.get("OLLAMA_BASE_URL", "").rstrip("/")
    if not base:
        return False
    timeout = _int_env("CCO_LLM_OLLAMA_HEALTH_TIMEOUT_MS", 1_500, 100) / 1000
    try:
        ok = httpx.get(f"{base}/api/tags", timeout=timeout).is_success
    except httpx.HTTPError:
        ok = False
    with _lock:
        _last_health_at = time.monotonic()
        _last_health_ok = ok
    return ok


@contextmanager
def ollama_lease() -> Iterator[None]:
    """Fail fast when the worker is offline, circuit-open, or already busy."""
    global _active, _circuit_open_until
    now = time.monotonic()
    with _lock:
        if now < _circuit_open_until:
            raise RuntimeError("Ollama circuit open")
        maximum = _int_env("CCO_LLM_OLLAMA_MAX_CONCURRENT", 1, 1)
        if _active >= maximum:
            raise RuntimeError("Ollama worker busy")

    if not _healthy():
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
    global _active, _circuit_open_until, _last_health_at, _last_health_ok
    with _lock:
        _active = 0
        _circuit_open_until = 0.0
        _last_health_at = 0.0
        _last_health_ok = False
