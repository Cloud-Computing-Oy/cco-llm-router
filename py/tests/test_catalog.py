import pytest
from cco_llm_router.catalog import MODEL_CATALOG
from cco_llm_router.router import DEFAULT_ALIASES, resolve_model


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


def test_glm_flash_has_task_specific_priority(monkeypatch):
    monkeypatch.setenv("ZAI_API_KEY", "test-key")
    expected = [MODEL_CATALOG[3][0]]
    assert resolve_model(
        "auto:glm-flash-pilot", allow_unknown_pricing=True
    ).specs == expected
    assert resolve_model("family:glm", allow_unknown_pricing=True).specs == expected

    for alias in ("auto:smart", "auto:code", "auto:big"):
        assert DEFAULT_ALIASES[alias][1].label == "zai:glm-5.3-flash"
    assert DEFAULT_ALIASES["auto:reasoning"][2].label == "zai:glm-5.3-flash"

    for alias in ("auto:fast", "auto:translate", "auto:cheap", "auto:paid"):
        assert all(spec.provider != "zai" for spec in DEFAULT_ALIASES[alias])
