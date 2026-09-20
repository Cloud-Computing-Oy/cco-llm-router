"""The hand-maintained __version__ must track pyproject.toml.

It sat at "0.6.0" for three releases (0.7, 0.8, 0.9) because nothing compared
the two; this test makes the drift impossible to reintroduce silently.
"""

from pathlib import Path

import cco_llm_router
import tomllib


def test_version_matches_pyproject():
    pyproject = Path(__file__).resolve().parents[1] / "pyproject.toml"
    with pyproject.open("rb") as fh:
        declared = tomllib.load(fh)["project"]["version"]
    assert cco_llm_router.__version__ == declared
