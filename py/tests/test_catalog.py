from cco_llm_router.catalog import MODEL_CATALOG
from cco_llm_router.pricing import estimate_cost_usd, price_of
from cco_llm_router.router import DEFAULT_ALIASES, resolve_model


def test_catalog_covers_supported_families():
    assert {row[1] for row in MODEL_CATALOG} == {
        "qwen", "kimi", "glm", "llama", "minimax", "mistral", "gemma", "nemotron"
    }


def test_glm_family_uses_reviewed_pricing_without_override(monkeypatch):
    monkeypatch.setenv("ZAI_API_KEY", "test-key")
    flash = MODEL_CATALOG[3][0]
    pro = MODEL_CATALOG[4][0]
    assert resolve_model("family:glm").specs == [flash, pro]
    assert any(spec == flash for spec in resolve_model("auto:smart").specs)
    assert any(spec == pro for spec in resolve_model("auto:smart").specs)
    assert price_of("zai", "glm-5.3-flash") == {
        "input_per_m": 0.15,
        "output_per_m": 0.5,
    }
    assert estimate_cost_usd("zai", "glm-5.3-flash", 1_000_000, 1_000_000) == 0.65
    assert price_of("zai", "glm-5.3") == {
        "input_per_m": 1.4,
        "output_per_m": 4.4,
    }
    assert estimate_cost_usd("zai", "glm-5.3", 1_000_000, 1_000_000) == 5.800000000000001


def test_glm_flash_has_task_specific_priority(monkeypatch):
    monkeypatch.setenv("ZAI_API_KEY", "test-key")
    flash = MODEL_CATALOG[3][0]
    pro = MODEL_CATALOG[4][0]
    assert resolve_model("auto:glm-flash-pilot").specs == [flash]
    assert resolve_model("family:glm").specs == [flash, pro]

    for alias in ("auto:smart", "auto:code", "auto:big"):
        assert DEFAULT_ALIASES[alias][1].label == "zai:glm-5.3-flash"
        assert DEFAULT_ALIASES[alias][2].label == "zai:glm-5.3"
    assert DEFAULT_ALIASES["auto:reasoning"][2].label == "zai:glm-5.3-flash"
    assert DEFAULT_ALIASES["auto:reasoning"][3].label == "zai:glm-5.3"

    for alias in ("auto:fast", "auto:translate", "auto:cheap", "auto:paid"):
        assert all(spec.provider != "zai" for spec in DEFAULT_ALIASES[alias])
