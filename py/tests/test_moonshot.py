from cco_llm_router.pricing import estimate_cost_usd, price_of
from cco_llm_router.router import DEFAULT_ALIASES, resolve_model


def test_kimi_is_explicit_opt_in_only():
    assert [spec.label for spec in DEFAULT_ALIASES["auto:kimi-pilot"]] == [
        "moonshot:kimi-k3"
    ]
    assert all(
        spec.provider != "moonshot"
        for alias, chain in DEFAULT_ALIASES.items()
        if alias not in {"auto:kimi-pilot", "family:kimi"}
        for spec in chain
    )


def test_kimi_resolves_when_key_is_configured(monkeypatch):
    monkeypatch.setenv("MOONSHOT_API_KEY", "test-key")
    resolved = resolve_model(
        "auto:kimi-pilot", allow_pilot=True, data_class="public"
    )
    assert [spec.label for spec in resolved.specs] == ["moonshot:kimi-k3"]


def test_kimi_fails_closed_without_public_data_opt_in(monkeypatch):
    monkeypatch.setenv("MOONSHOT_API_KEY", "test-key")
    for options in (
        {},
        {"allow_pilot": True, "data_class": "confidential"},
    ):
        try:
            resolve_model("auto:kimi-pilot", **options)
        except RuntimeError as exc:
            assert "explicit public-data pilot" in str(exc)
        else:
            raise AssertionError("Kimi pilot unexpectedly accepted unsafe options")


def test_kimi_uses_conservative_cache_miss_pricing():
    assert price_of("moonshot", "kimi-k3") == {
        "input_per_m": 3.0,
        "output_per_m": 15.0,
    }
    assert estimate_cost_usd("moonshot", "kimi-k3", 1_000_000, 1_000_000) == 18.0
