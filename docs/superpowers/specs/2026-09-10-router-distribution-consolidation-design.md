# Consolidating cco-llm-router Copies: Wheel Distribution + Pinned Consumers

**Date:** 2026-09-10
**Status:** Design approved (brainstorming 2026-09-10) — pending spec review
**Author:** Claude Code + Jarmo (Cloud Computing Oy)

## 1. Context and problem

The router is vendored or installed in many places, in several versions:

- **Python source copies (the real duplication).** `AinoAI/vendor/cco-llm-router-py`
  (22 tracked files, 0.8.0) and `AgentX/backend/vendor/cco-llm-router` (21 tracked
  files, 0.8.0) are committed copies of `py/` from commit `743e68b`. Three stale
  clones carry 0.3.0 copies predating Kimi support. Refreshing them is a manual
  `rsync` documented in `AinoAI/vendor/cco-llm-router-py/VENDORED.md`, so they
  drift silently — the Python sibling has since shipped 0.8.1 (peak pricing).
- **TS installs.** 13 `node_modules` installs pinned at 0.19.0/0.17.0, plus two
  consumers pinned to **commit archive tarballs** instead of versions
  (`Dynamic-Site-Builder` → `e59eb105`, `cco-code-agent` → `6cd14208`). Those two
  cannot be bumped by editing a version range.

Both vendor docs justify copying by "no GitHub credentials on the deploy host".
That is only true for **ssh**: the repo is public, and the AinoAI deploy host
(`dev-arm-cax31`) was verified to reach `github.com` and `pypi.org` over https
(HTTP 200). The credential-free paths are therefore open.

The TS registry (`npm.pkg.github.com`) currently holds up to **0.20.0**; 0.21.0
and 0.21.1 were never published, and the repo has no publish workflow.

## 2. Goals

1. One source of truth for the Python package: consumers install a **released
   artifact**, not a copied source tree.
2. Delete the two live vendor copies and the Dockerfile/`requirements.txt`
   plumbing that exists only to carry them.
3. Make every TS consumer reference a **version**, never a commit tarball.

**Non-goals:** migrating the three stale AgentX clones (0.3.0, last commits
2026-08-24/09-01 — out of scope by decision); publishing to PyPI; publishing the
TS package to the public npm registry; changing the shim (already a `file:`
dependency on this repo).

## 3. Decision: distribution channels

**Python — wheel attached to a GitHub Release.** Tag `py-v<version>` triggers a
workflow that builds `py/` and attaches the wheel + sdist to the release.
Consumers pin the asset URL with the `[openai,google]` / `[all]` extras.

Chosen over `git+https …#subdirectory=py` (needs `git` in `python:3.12-slim`,
builds from source on every install) and over PyPI (new public artifact and
credentials, no capability the release asset lacks). Release assets of a public
repo need no credentials and no git.

**TS — publish 0.21.1 to GitHub Packages**, then move consumers to `^0.21.1` and
convert the two archive pins to the same version range.

## 4. Design

### 4.1 Python release workflow (this repo)

`.github/workflows/python-release.yml`, trigger `push: tags: ['py-v*']`:

1. `actions/setup-python` 3.12, `pip install './py[dev]'`
2. `python -m build py` (already the CI build command)
3. `gh release create "$TAG" dist/* --title …` (or upload to an existing release)

First release: `py-v0.8.1` (the current `py/pyproject.toml` version — never
published anywhere, so no bump is needed to start).

Version rule: the tag's version must equal `py/pyproject.toml`'s `version`;
the workflow fails otherwise, so a wheel can never be published under a version
it does not carry.

### 4.2 AinoAI

- `pipeline/requirements.txt`: replace `./vendor/cco-llm-router-py[openai,google]`
  with
  `cco-llm-router[openai,google] @ https://github.com/Cloud-Computing-Oy/cco-llm-router/releases/download/py-v0.8.1/cco_llm_router-0.8.1-py3-none-any.whl`
- Delete `vendor/cco-llm-router-py/` (incl. `VENDORED.md`, `LICENSE` copy).
- `pipeline/llm_client.py`: drop the "vendored" wording from the docstring; the
  optional-import fallback behaviour stays exactly as it is.
- `scripts/run-weekly.sh` re-installs requirements each run, so the pinned wheel
  reaches the host with no new mechanism.

### 4.3 AgentX

- `backend/requirements.txt:60`: replace `./vendor/cco-llm-router[all]` with the
  same URL pin (extras `[all]`).
- Remove `COPY vendor/ ./vendor/` from `backend/Dockerfile:13` and
  `backend/Dockerfile.worker:6`; delete `backend/vendor/`.
- The image already installs from PyPI, so the added GitHub https fetch is the
  only new network dependency, and it needs no credentials.

### 4.4 TS consumers

1. Publish 0.21.1 (`npm publish` from this repo, GitHub Packages, `restricted`).
2. Bump in eleven repos: `0.19.0` → `^0.21.1` (Invoicify, cc-os, LexAI-Web,
   Lakiapuri, Portfolio_Tracker, ai-cloudcomputing, ai-cloudcomputing-audio,
   ai-cloudcomputing-deps, expat-aivozone, cc-code, Dynamic-Site-Builder);
   `0.17.0` → `^0.21.1` (cco-code-agent).
3. Convert the two archive pins (`Dynamic-Site-Builder`, `cco-code-agent`) to the
   version range in the same edit.
4. Reinstall and run each repo's typecheck/tests where they exist.

## 5. Verification

| Check | How |
|---|---|
| Wheel is valid and installable | Install the release URL into a clean venv, `python -c "import cco_llm_router"` |
| Tag/version guard | Publish attempt with mismatched tag fails the workflow |
| AinoAI unaffected | `pytest tests/`; requirements install from the URL on the dev host |
| AgentX unaffected | `docker build` the backend image + `pytest backend/tests/` |
| TS bump | `npm install` + typecheck in each repo; `npm ls @cloud-computing-oy/llm-router` shows 0.21.1 |
| Registry | `npm view @cloud-computing-oy/llm-router versions` lists 0.21.1 |

## 6. Risks and rollback

- **Deploy-time network dependency.** Both consumer environments were verified to
  have https access; the wheel is also cached by pip after first fetch. Rollback:
  restore the vendor directory from git history and the old requirement line.
- **`npm publish` is effectively irreversible.** Version deletion is possible but
  breaks anyone who installed it. Publishing 0.21.1 is a one-way action and was
  explicitly approved.
- **AgentX is production** (aino.aivozone.com). The image build is verified
  locally before any deploy; the change does not alter runtime behaviour, only
  where the dependency comes from.
- **Version skew while a consumer is mid-bump**: consumers pin exact URLs / `^`
  ranges, so a half-migrated fleet keeps working — each repo is an independent PR.

## 7. Out of scope

Stale AgentX clones (qualified-leads, hybrid-widget, the aino-webhook worktree);
PyPI; public npm publication; the TS package's `restricted` visibility; the
remaining 0.19.0-era pricing differences in already-installed consumers.
