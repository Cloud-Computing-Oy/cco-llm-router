from cco_llm_router.automatic_routing import select_automatic_alias


def test_short_low_risk_work_uses_laptop():
    assert select_automatic_alias(prompt="Summarise this short note.") == "auto:laptop-assisted"


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
