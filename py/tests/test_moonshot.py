from cco_llm_router.pricing import estimate_cost_usd, price_of
from cco_llm_router.router import DEFAULT_ALIASES, resolve_model


def test_kimi_ships_in_top_tier_default_chains():
    for alias in ("auto:smart", "auto:reasoning", "auto:big", "auto:paid"):
        assert any(
            spec.provider == "moonshot" and spec.model == "kimi-k3"
            for spec in DEFAULT_ALIASES[alias]
        ), alias
    for alias in ("auto:fast", "auto:translate", "auto:code", "auto:cheap", "auto:local"):
        assert all(spec.provider != "moonshot" for spec in DEFAULT_ALIASES[alias]), alias


def test_kimi_resolves_without_any_opt_in_flag(monkeypatch):
    monkeypatch.setenv("MOONSHOT_API_KEY", "test-key")
    resolved = resolve_model("family:kimi")
    assert [spec.label for spec in resolved.specs] == ["moonshot:kimi-k3"]
    resolved = resolve_model("moonshot:kimi-k3")
    assert [spec.label for spec in resolved.specs] == ["moonshot:kimi-k3"]


def test_kimi_uses_conservative_cache_miss_pricing():
    assert price_of("moonshot", "kimi-k3") == {
        "input_per_m": 3.0,
        "output_per_m": 15.0,
    }
    assert estimate_cost_usd("moonshot", "kimi-k3", 1_000_000, 1_000_000) == 18.0
