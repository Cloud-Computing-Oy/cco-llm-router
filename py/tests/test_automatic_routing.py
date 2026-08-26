import pytest

from cco_llm_router.automatic_routing import select_automatic_alias
from cco_llm_router.router import resolve_model


def test_only_public_or_synthetic_short_work_uses_facf_laptop():
    assert select_automatic_alias(prompt="Summarise this short note.") == "auto:smart"
    assert (
        select_automatic_alias(prompt="Summarise this short note.", data_class="public")
        == "auto:facf-laptop"
    )
    assert (
        select_automatic_alias(prompt="Summarise this short note.", data_class="synthetic")
        == "auto:facf-laptop"
    )


def test_high_risk_and_reasoning_work_use_stronger_routes():
    assert select_automatic_alias(prompt="Review this tax calculation.") == "auto:reasoning"
    assert select_automatic_alias(prompt="Compare options.", task_risk="high") == "auto:reasoning"
    assert select_automatic_alias(prompt="Analyse this proposal.") == "auto:smart"


def test_large_context_and_code_do_not_use_small_laptop_model():
    assert select_automatic_alias(prompt="x" * 12_001) == "auto:big"
    assert select_automatic_alias(prompt="Implement a Python function.") == "auto:code"


def test_confidential_data_is_not_automatically_sent_to_laptop_fallback_chain():
    assert (
        select_automatic_alias(prompt="Rewrite this.", data_class="confidential")
        == "auto:smart"
    )


def test_explicit_facf_laptop_aliases_fail_closed_for_internal_data():
    with pytest.raises(RuntimeError, match="only data_class"):
        resolve_model("auto:facf-laptop", data_class="internal")
    with pytest.raises(RuntimeError, match="only data_class"):
        resolve_model("auto:laptop-assisted")
