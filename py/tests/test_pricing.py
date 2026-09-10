"""Peak/off-peak pricing parity with src/pricing.ts (DeepSeek V4.1 Flash)."""
from datetime import datetime, timezone

from cco_llm_router.pricing import effective_price, estimate_cost_usd, price_of

# DeepSeek V4.1 Flash (2026-09-10): off-peak $0.15/$0.6, peak $0.3/$1.2.
# Peak windows are UTC weekdays 01-04 and 06-10. 2026-09-10 is a Thursday.
OFF_PEAK = {"input_per_m": 0.15, "output_per_m": 0.6}
PEAK = {"input_per_m": 0.3, "output_per_m": 1.2}


def test_v41_flash_list_price_carries_off_peak_and_peak_rates():
    for model in ("deepseek-flash", "deepseek-v4-flash", "deepseek-v4-pro"):
        price = price_of("deepseek", model)
        assert price["input_per_m"] == 0.15
        assert price["output_per_m"] == 0.6
        assert price["peak"] == PEAK


def test_effective_price_off_peak_outside_windows():
    at = datetime(2026, 9, 10, 12, 0, tzinfo=timezone.utc)
    assert effective_price("deepseek", "deepseek-flash", at) == OFF_PEAK


def test_effective_price_peak_inside_window():
    at = datetime(2026, 9, 10, 2, 0, tzinfo=timezone.utc)
    assert effective_price("deepseek", "deepseek-flash", at) == PEAK


def test_peak_windows_are_half_open_at_utc_boundaries():
    cases = [
        (datetime(2026, 9, 10, 1, 0, tzinfo=timezone.utc), PEAK),
        (datetime(2026, 9, 10, 4, 0, tzinfo=timezone.utc), OFF_PEAK),
        (datetime(2026, 9, 10, 6, 0, tzinfo=timezone.utc), PEAK),
        (datetime(2026, 9, 10, 10, 0, tzinfo=timezone.utc), OFF_PEAK),
    ]
    for at, expected in cases:
        assert effective_price("deepseek", "deepseek-flash", at) == expected, at


def test_weekends_are_off_peak_regardless_of_hour():
    assert effective_price("deepseek", "deepseek-flash", datetime(2026, 9, 12, 2, 0, tzinfo=timezone.utc)) == OFF_PEAK
    assert effective_price("deepseek", "deepseek-flash", datetime(2026, 9, 13, 7, 0, tzinfo=timezone.utc)) == OFF_PEAK


def test_naive_datetimes_are_treated_as_utc():
    # Naiivi aikaleima on testin tarkoitus: se tulkitaan UTC:ksi.
    naive = datetime(2026, 9, 10, 2, 0)  # noqa: DTZ001
    assert effective_price("deepseek", "deepseek-flash", naive) == PEAK


def test_providers_without_peak_rates_are_unaffected():
    at = datetime(2026, 9, 10, 2, 0, tzinfo=timezone.utc)
    assert effective_price("moonshot", "kimi-k3", at) == {"input_per_m": 3.0, "output_per_m": 15.0}
    assert "peak" not in price_of("moonshot", "kimi-k3")


def test_estimate_cost_bills_the_rate_in_effect_at_the_call_instant():
    off = datetime(2026, 9, 10, 12, 0, tzinfo=timezone.utc)
    peak = datetime(2026, 9, 10, 2, 0, tzinfo=timezone.utc)
    assert estimate_cost_usd("deepseek", "deepseek-flash", 1_000_000, 1_000_000, off) == 0.75
    assert estimate_cost_usd("deepseek", "deepseek-flash", 1_000_000, 1_000_000, peak) == 1.5


def test_default_chains_lead_with_the_canonical_deepseek_flash_id():
    from cco_llm_router.router import DEFAULT_ALIASES

    for alias, chain in DEFAULT_ALIASES.items():
        hops = [s for s in chain if s.provider == "deepseek"]
        if not hops:
            continue
        # Upstream /models no longer lists deepseek-v4-flash, so the nightly
        # dataset marks it retired and the resolver skips it — leading with it
        # silently hands the chain to the next provider.
        assert hops[0].model == "deepseek-flash", alias
        assert all(s.model != "deepseek-v4-flash" for s in chain), alias
