from cco_llm_router.catalog import MODEL_CATALOG
from cco_llm_router.pricing import estimate_cost_usd, price_of
from cco_llm_router.router import DEFAULT_ALIASES, resolve_model


def test_catalog_covers_supported_families():
    assert {row[1] for row in MODEL_CATALOG} == {
        "qwen", "kimi", "glm", "llama", "minimax", "mistral", "gemma", "nemotron"
    }


def test_glm_family_uses_reviewed_pricing_without_override(monkeypatch):
    monkeypatch.setenv("ZAI_API_KEY", "test-key")
    expected = [MODEL_CATALOG[3][0]]
    assert resolve_model("family:glm").specs == expected
    assert any(spec == expected[0] for spec in resolve_model("auto:smart").specs)
    assert price_of("zai", "glm-5.3-flash") == {
        "input_per_m": 0.15,
        "output_per_m": 0.5,
    }
    assert estimate_cost_usd("zai", "glm-5.3-flash", 1_000_000, 1_000_000) == 0.65


def test_glm_flash_has_task_specific_priority(monkeypatch):
    monkeypatch.setenv("ZAI_API_KEY", "test-key")
    expected = [MODEL_CATALOG[3][0]]
    assert resolve_model("auto:glm-flash-pilot").specs == expected
    assert resolve_model("family:glm").specs == expected

    for alias in ("auto:smart", "auto:code", "auto:big"):
        assert DEFAULT_ALIASES[alias][1].label == "zai:glm-5.3-flash"
    assert DEFAULT_ALIASES["auto:reasoning"][2].label == "zai:glm-5.3-flash"

    for alias in ("auto:fast", "auto:translate", "auto:cheap", "auto:paid"):
        assert all(spec.provider != "zai" for spec in DEFAULT_ALIASES[alias])
