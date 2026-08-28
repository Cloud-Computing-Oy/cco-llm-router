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


def test_glm_flash_pilot_is_explicit_and_default_chains_are_unchanged(monkeypatch):
    monkeypatch.setenv("ZAI_API_KEY", "test-key")
    expected = [MODEL_CATALOG[3][0]]
    assert resolve_model(
        "auto:glm-flash-pilot", allow_unknown_pricing=True
    ).specs == expected
    assert resolve_model("family:glm", allow_unknown_pricing=True).specs == expected

    assert DEFAULT_ALIASES["auto:smart"][0].label == "deepseek:deepseek-v4-flash"
    assert DEFAULT_ALIASES["auto:code"][0].label == "deepseek:deepseek-v4-flash"
    assert DEFAULT_ALIASES["auto:reasoning"][0].label == "deepseek:deepseek-v4-flash"
    assert DEFAULT_ALIASES["auto:big"][0].label == "deepseek:deepseek-v4-flash"
