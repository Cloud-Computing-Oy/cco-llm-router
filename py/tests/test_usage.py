import json

from cco_llm_router.usage import record_usage


def test_usage_state_is_private_and_valid(monkeypatch, tmp_path):
    monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path))
    record_usage("moonshot", "kimi-k3", 100, 20)

    state = tmp_path / "cco-llm-router" / "usage.json"
    assert json.loads(state.read_text())["providers"]
    assert state.stat().st_mode & 0o077 == 0
