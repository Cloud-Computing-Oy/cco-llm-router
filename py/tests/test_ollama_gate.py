import httpx
import pytest

from cco_llm_router.ollama_gate import _reset_for_tests, ollama_lease
from cco_llm_router.router import DEFAULT_ALIASES


@pytest.fixture(autouse=True)
def reset_gate():
    _reset_for_tests()
    yield
    _reset_for_tests()


def test_laptop_alias_matches_typescript_chain():
    assert [spec.label for spec in DEFAULT_ALIASES["auto:laptop-assisted"]] == [
        "ollama:qwen2.5:14b",
        "google:gemini-2.5-flash",
        "deepinfra:meta-llama/Meta-Llama-3.1-8B-Instruct",
        "google-paid:gemini-2.5-flash",
    ]


def test_healthy_worker_allows_one_lease(monkeypatch):
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://laptop.test:11434/")
    monkeypatch.setattr(
        httpx,
        "get",
        lambda url, timeout: httpx.Response(200, request=httpx.Request("GET", url)),
    )
    with ollama_lease():
        with pytest.raises(RuntimeError, match="worker busy"):
            with ollama_lease():
                pass


def test_failed_health_check_opens_circuit(monkeypatch):
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://offline.test:11434")

    def offline(url, timeout):
        raise httpx.ConnectError("offline")

    monkeypatch.setattr(httpx, "get", offline)
    with pytest.raises(RuntimeError, match="health check failed"):
        with ollama_lease():
            pass
    with pytest.raises(RuntimeError, match="circuit open"):
        with ollama_lease():
            pass
