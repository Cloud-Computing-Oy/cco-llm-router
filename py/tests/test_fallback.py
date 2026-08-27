from unittest.mock import patch

from cco_llm_router import providers
from cco_llm_router.router import CallSpec
from cco_llm_router.types import Spec


def test_call_chain_tries_every_provider_error_before_giving_up():
    calls: list[str] = []

    def call(spec, **_kwargs):
        calls.append(spec.label)
        if spec.provider == "groq":
            raise ValueError("model does not exist or you do not have access")
        return "ok", None

    chain = CallSpec(
        [Spec("groq", "removed"), Spec("deepseek", "deepseek-v4-flash")]
    )
    with patch("cco_llm_router.router.providers.call", side_effect=call):
        assert chain.call(system="", prompt="test") == "ok"

    assert calls == ["groq:removed", "deepseek:deepseek-v4-flash"]


def test_call_chain_retries_once_only_when_every_failure_is_transient():
    calls: list[str] = []

    def call(spec, **_kwargs):
        calls.append(spec.label)
        if len(calls) <= 2:
            raise providers.TransientError("rate limited")
        return "recovered", None

    chain = CallSpec([Spec("google", "one"), Spec("deepseek", "two")])
    with (
        patch("cco_llm_router.router.providers.call", side_effect=call),
        patch("cco_llm_router.router.time.sleep") as sleep,
    ):
        assert chain.call(system="", prompt="test") == "recovered"

    sleep.assert_called_once_with(8)
    assert calls == ["google:one", "deepseek:two", "google:one"]
