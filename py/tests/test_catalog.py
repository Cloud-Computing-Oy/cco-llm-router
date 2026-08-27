import pytest
from cco_llm_router.catalog import MODEL_CATALOG
from cco_llm_router.router import resolve_model


def test_catalog_covers_supported_families():
    assert {row[1] for row in MODEL_CATALOG} == {
        "qwen", "kimi", "glm", "llama", "minimax", "mistral", "gemma", "nemotron"
    }


def test_unknown_price_family_fails_closed(monkeypatch):
    monkeypatch.setenv("ZAI_API_KEY", "test-key")
    with pytest.raises(RuntimeError, match="No reviewed-price provider"):
        resolve_model("family:glm")
    assert resolve_model("family:glm", allow_unknown_pricing=True).specs == [
        MODEL_CATALOG[3][0]
    ]
