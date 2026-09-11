# Router Copy Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two live Python vendor copies (AinoAI, AgentX) with a wheel published as a GitHub Release asset, and move TS consumers from commit-tarball pins to version ranges.

**Architecture:** The router repo publishes `py/` as a wheel on any `py-v*` tag; consumers pin that release-asset URL with PEP 508 direct references (no credentials, no git, works in `python:3.12-slim`). The TS package 0.21.1 is published to GitHub Packages, and every consumer moves to `^0.21.1`.

**Tech Stack:** TypeScript (node 22 + tsx + node:test), Python 3.11+ (hatchling, pytest, ruff), GitHub Actions, Docker, npm (GitHub Packages).

**Spec:** `docs/superpowers/specs/2026-09-10-router-distribution-consolidation-design.md`

## Global Constraints

- Repo is **public** (Apache-2.0): release assets need no credentials; never add tokens to requirements files.
- Wheel URL form (exact): `https://github.com/Cloud-Computing-Oy/cco-llm-router/releases/download/py-v0.8.1/cco_llm_router-0.8.1-py3-none-any.whl`
- Python extras in use: AinoAI `[openai,google]`, AgentX `[all]`.
- AinoAI default branch is `master`; AgentX default branch is `main`; router default branch is `main`.
- PRs into any of these repos pass two local gates: repo-audit (touch `/tmp/claude-repoaudit-<session>`) and Codex review (resolve P1/P2, touch `/tmp/claude-codexrev-<session>-<PR>`). Both markers must be written with the sandbox disabled.
- Out of scope: three stale AgentX clones, PyPI, public npm.

---

### Task 1: Python release workflow with a tag/version guard

**Files:**
- Create: `scripts/check-py-tag.ts`
- Create: `scripts/check-py-tag.test.ts`
- Create: `.github/workflows/python-release.yml`
- Modify: `py/README.md` (add a "Consuming a release" section)

**Interfaces:**
- Produces: `checkTag(tag: string, pyprojectVersion: string): { ok: true } | { ok: false; reason: string }`, and a CLI entry (`node --import tsx scripts/check-py-tag.ts <tag>`) that reads `py/pyproject.toml` and exits 1 with the reason on failure.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/check-py-tag.test.ts
import assert from "node:assert/strict";
import test from "node:test";

import { checkTag } from "./check-py-tag";

test("accepts a py-v tag matching pyproject", () => {
  assert.deepEqual(checkTag("py-v0.8.1", "0.8.1"), { ok: true });
});

test("rejects a tag whose version differs from pyproject", () => {
  const r = checkTag("py-v0.8.2", "0.8.1");
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.reason : "", /0\.8\.2.*0\.8\.1/);
});

test("rejects a tag that is not py-vX.Y.Z", () => {
  assert.equal(checkTag("v0.21.1", "0.8.1").ok, false);
  assert.equal(checkTag("py-v0.8", "0.8.1").ok, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test scripts/check-py-tag.test.ts`
Expected: FAIL — cannot find module './check-py-tag'

- [ ] **Step 3: Write minimal implementation**

```ts
// scripts/check-py-tag.ts
/**
 * Guards the python-release workflow: a wheel must never be published under a
 * version it does not carry. Run from the repo root.
 */
import fs from "node:fs";

export function checkTag(tag: string, pyprojectVersion: string): { ok: true } | { ok: false; reason: string } {
  const match = /^py-v(\d+\.\d+\.\d+)$/.exec(tag);
  if (!match) return { ok: false, reason: `tag "${tag}" is not of the form py-vX.Y.Z` };
  if (match[1] !== pyprojectVersion) {
    return { ok: false, reason: `tag version ${match[1]} != py/pyproject.toml ${pyprojectVersion}` };
  }
  return { ok: true };
}

if (process.argv[1]?.endsWith("check-py-tag.ts")) {
  const tag = process.argv[2] ?? "";
  const pyproject = fs.readFileSync("py/pyproject.toml", "utf8");
  const version = /^version = "([^"]+)"/m.exec(pyproject)?.[1] ?? "";
  const result = checkTag(tag, version);
  if (!result.ok) {
    console.error(`check-py-tag: ${result.reason}`);
    process.exit(1);
  }
  console.log(`check-py-tag: ${tag} matches py/pyproject.toml`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test scripts/check-py-tag.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Verify the CLI both ways**

```bash
node --import tsx scripts/check-py-tag.ts py-v0.8.1   # exits 0, prints match
node --import tsx scripts/check-py-tag.ts py-v0.9.0; echo "exit=$?"   # exits 1
```

- [ ] **Step 6: Write the workflow**

```yaml
# .github/workflows/python-release.yml
name: python-release
on:
  push:
    tags: ["py-v*"]
permissions:
  contents: write
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: npm ci
      - run: python -m pip install build
      - name: Verify tag matches py/pyproject.toml
        run: node --import tsx scripts/check-py-tag.ts "${{ github.ref_name }}"
      - run: python -m build py --outdir dist-py
      - name: Publish wheel + sdist as release assets
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh release create "${{ github.ref_name }}" dist-py/* \
            --title "Python cco-llm-router ${{ github.ref_name }}" \
            --notes "Python sibling wheel + sdist for ${{ github.ref_name }}" \
            || gh release upload "${{ github.ref_name }}" dist-py/* --clobber
```

- [ ] **Step 7: Document consumption in py/README.md**

Add under the install section:

````markdown
### Installing a released wheel (no credentials, no git)

```bash
pip install "cco-llm-router[all] @ https://github.com/Cloud-Computing-Oy/cco-llm-router/releases/download/py-v0.8.1/cco_llm_router-0.8.1-py3-none-any.whl"
```

The asset is built and attached by `.github/workflows/python-release.yml` on
every `py-v*` tag; the tag version must equal `py/pyproject.toml`'s version.
````

- [ ] **Step 8: Commit and open the PR**

```bash
git checkout -b feat/python-release-wheel
git add scripts/check-py-tag.ts scripts/check-py-tag.test.ts .github/workflows/python-release.yml py/README.md
git commit -m "feat(release): publish the Python wheel as a release asset"
git push -u origin feat/python-release-wheel
gh pr create --title "feat(release): publish the Python wheel as a release asset" --body "Implements the distribution half of the consolidation design. Wheel + sdist are attached to every py-v* release; a tag/version guard stops a wheel being published under a version it does not carry."
```

- [ ] **Step 9: Pass the gates and merge**

```bash
cd /home/jmart/cc-code && npm run repo-audit -- run https://github.com/Cloud-Computing-Oy/cco-llm-router --branch feat/python-release-wheel
# Gate markers: the hook prints the exact paths it wants, e.g.
#   /tmp/claude-repoaudit-<session-id>      (one per session)
#   /tmp/claude-codexrev-<session-id>-<PR>  (one per PR)
# Write them with the sandbox disabled, otherwise the hook process cannot see them.
touch /tmp/claude-repoaudit-<session-id>
gh pr merge <PR> --squash --delete-branch         # after resolving any P1/P2 Codex findings
touch /tmp/claude-codexrev-<session-id>-<PR>
# Resolve every P1/P2 Codex finding before touching the Codex marker; never touch it to skip review.
```

---

### Task 2: Cut the py-v0.8.1 release

**Files:** none (tag + verification only)

**Interfaces:**
- Produces: the release asset URL every consumer task pins:
  `https://github.com/Cloud-Computing-Oy/cco-llm-router/releases/download/py-v0.8.1/cco_llm_router-0.8.1-py3-none-any.whl`

- [ ] **Step 1: Tag main and push**

```bash
cd /home/jmart/cco-llm-router && git checkout main && git pull --ff-only
git tag py-v0.8.1 && git push origin py-v0.8.1
```

- [ ] **Step 2: Watch the workflow**

```bash
gh run watch "$(gh run list --workflow=python-release --limit 1 --json databaseId -q '.[0].databaseId')"
```
Expected: success

- [ ] **Step 3: Verify the asset installs in a clean venv**

```bash
rm -rf /tmp/venv-release && python3 -m venv /tmp/venv-release
/tmp/venv-release/bin/pip install -q "cco-llm-router[openai,google] @ https://github.com/Cloud-Computing-Oy/cco-llm-router/releases/download/py-v0.8.1/cco_llm_router-0.8.1-py3-none-any.whl"
/tmp/venv-release/bin/python -c "
import importlib.metadata as m, cco_llm_router as r
print('versio', m.version('cco-llm-router'), r.effective_price('deepseek','deepseek-flash'))"
```
Expected: `versio 0.8.1 {'input_per_m': 0.15, 'output_per_m': 0.6}`

---

### Task 3: AinoAI — drop the vendor copy

**Files:**
- Modify: `AinoAI/pipeline/requirements.txt:11-15`
- Modify: `AinoAI/pipeline/llm_client.py` (docstring only)
- Delete: `AinoAI/vendor/cco-llm-router-py/` (22 tracked files)

**Interfaces:**
- Consumes: the Task 2 release URL.

- [ ] **Step 1: Branch off master**

```bash
cd /home/jmart/AinoAI && git checkout master && git pull --ff-only && git checkout -b chore/router-wheel
```

- [ ] **Step 2: Replace the requirement**

`pipeline/requirements.txt` — replace the vendored block with:

```
# Published as a GitHub Release asset (public repo → no credentials, no git).
# Refresh = bump the version in this URL; see the router's py/README.md.
cco-llm-router[openai,google] @ https://github.com/Cloud-Computing-Oy/cco-llm-router/releases/download/py-v0.8.1/cco_llm_router-0.8.1-py3-none-any.whl
```

- [ ] **Step 3: Delete the vendor directory and update the docstring**

```bash
git rm -r --quiet vendor/cco-llm-router-py
grep -rn "vendored\|vendor/" pipeline/llm_client.py
```
In `pipeline/llm_client.py`, replace "the vendored cco-llm-router" wording with "the cco-llm-router package" and drop the `See vendor/…/VENDORED.md` line. The optional-import try/except stays untouched.

- [ ] **Step 4: Check for leftover references**

```bash
grep -rn "vendor/cco-llm-router" --exclude-dir=.git --exclude-dir=node_modules . || echo "no references left"
```
Expected: no references (any hit must be fixed before continuing).

- [ ] **Step 5: Install from the URL and run the tests**

```bash
python3 -m venv /tmp/venv-aino && /tmp/venv-aino/bin/pip install -q -r pipeline/requirements.txt
/tmp/venv-aino/bin/python -c "import cco_llm_router; print('import OK')"
/tmp/venv-aino/bin/python -m pytest tests/ -q
```
Expected: import OK; pytest result recorded verbatim (pre-existing failures are acceptable only if they also fail on master).

- [ ] **Step 6: Commit, PR, merge**

```bash
git add -A pipeline && git commit -m "chore(deps): install cco-llm-router from the released wheel" && git push -u origin chore/router-wheel
gh pr create --title "chore(deps): install cco-llm-router from the released wheel" --body "Drops the committed vendor copy (22 files) in favour of the py-v0.8.1 release asset. Deploy hosts were verified to reach github.com over https, so no credentials are needed. Rollback: restore vendor/cco-llm-router-py from git history."
```
Then run the repo-audit + Codex gates for AinoAI and merge.

---

### Task 4: AgentX — drop the vendor copy

**Files:**
- Modify: `AgentX/backend/requirements.txt:52-60`
- Modify: `AgentX/backend/Dockerfile:13`
- Modify: `AgentX/backend/Dockerfile.worker:6`
- Delete: `AgentX/backend/vendor/` (21 tracked files)

**Interfaces:**
- Consumes: the Task 2 release URL.

- [ ] **Step 1: Branch off main**

```bash
cd /home/jmart/AgentX && git checkout main && git pull --ff-only && git checkout -b chore/router-wheel
```

- [ ] **Step 2: Replace the requirement**

`backend/requirements.txt` lines 52-60 become:

```
# Published as a GitHub Release asset (public repo → no credentials, no git, so
# it also installs inside python:3.12-slim without adding git to the image).
# The [all] extra pulls the provider SDKs (anthropic, google-genai, openai) so
# the auto:fast fallback chain is fully usable.
cco-llm-router[all] @ https://github.com/Cloud-Computing-Oy/cco-llm-router/releases/download/py-v0.8.1/cco_llm_router-0.8.1-py3-none-any.whl
```

- [ ] **Step 3: Drop the Docker COPY lines**

Remove the `COPY vendor/ ./vendor/` line from `backend/Dockerfile` and `backend/Dockerfile.worker`.

- [ ] **Step 4: Delete the vendor directory and check references**

```bash
git rm -r --quiet backend/vendor
grep -rn "vendor/cco-llm-router\|COPY vendor" --exclude-dir=.git . || echo "no references left"
```
Expected: no references left.

- [ ] **Step 5: Verify with the real image build and tests**

```bash
docker build -f backend/Dockerfile -t agentx-backend-test backend/ 2>&1 | tail -5
docker run --rm agentx-backend-test python -c "import importlib.metadata as m; print(m.version('cco-llm-router'))"
python3 -m venv /tmp/venv-agentx && /tmp/venv-agentx/bin/pip install -q -r backend/requirements.txt
/tmp/venv-agentx/bin/python -m pytest backend/tests/ -q
```
Expected: image builds, version prints `0.8.1` inside it, pytest result recorded verbatim.

- [ ] **Step 6: Commit, PR, merge**

```bash
git add -A backend && git commit -m "chore(deps): install cco-llm-router from the released wheel" && git push -u origin chore/router-wheel
gh pr create --title "chore(deps): install cco-llm-router from the released wheel" --body "Drops the committed vendor copy and the Docker COPY vendor lines in favour of the py-v0.8.1 release asset. Verified with a real image build. Rollback: restore backend/vendor from git history."
```
Then run the repo-audit + Codex gates for AgentX and merge.

---

### Task 5: Publish the TypeScript package 0.21.1

**Files:** none (publish only)

- [ ] **Step 1: Confirm the version and tag state**

```bash
cd /home/jmart/cco-llm-router && git checkout main && git pull --ff-only
node -e "console.log(require('./package.json').version)"   # expect 0.21.1
gh release list --limit 3
```

- [ ] **Step 2: Publish (irreversible — approved in the spec)**

```bash
npm publish
```
Expected: `+ @cloud-computing-oy/llm-router@0.21.1`

- [ ] **Step 3: Verify the registry**

```bash
npm view @cloud-computing-oy/llm-router versions --json | tail -5
```
Expected: `0.21.1` present.

- [ ] **Step 4: Tag the release**

```bash
git tag v0.21.1 && git push origin v0.21.1
```

---

### Task 6: Bump the ten range-pinned consumers to ^0.21.1

**Files (each own repo, own PR):** the `@cloud-computing-oy/llm-router` dependency line in `package.json`

Verified pins (2026-09-11):

- Exact `0.19.0` (9): `cc-os/package.json`, `LexAI-Web/web/package.json`,
  `Lakiapuri/package.json`, `Portfolio_Tracker/package.json`,
  `ai-cloudcomputing/package.json`, `ai-cloudcomputing-audio/package.json`,
  `ai-cloudcomputing-deps/package.json`, `expat-aivozone/package.json`,
  `cc-code/package.json`
- Range `^0.10.0` (1): `Invoicify/package.json` (its lockfile has 0.19.0)

`cc-code/dist-core/package.json` is a **generated** staging copy of
`@cloud-computing-oy/cc-core` (`scripts/publish-core.ts` resolves versions from
cc-code's root manifest). Do not hand-edit it — bumping cc-code's root pin is
what regenerates it.

For each repo, in batches of three:

- [ ] **Step 1: Branch** — `git checkout main && git pull --ff-only && git checkout -b chore/router-0.21.1` (use `master` where that is the default branch).
- [ ] **Step 2: Edit the pin** — set `"@cloud-computing-oy/llm-router": "^0.21.1"` (replacing `0.19.0` or `^0.10.0`).
- [ ] **Step 3: Install and verify**

```bash
npm install
npm ls @cloud-computing-oy/llm-router        # expect 0.21.1
npm run typecheck --if-present
npm test --if-present
```
Record the outcome verbatim; a red typecheck that also fails before the bump is pre-existing.

- [ ] **Step 4: Commit, PR, merge** — `git commit -am "chore(deps): llm-router ^0.21.1"`, PR body noting the peak-pricing and canonical-id changes, then the repo-audit + Codex gates.

---

### Task 7: Convert the two archive pins

**Files:**
- `Dynamic-Site-Builder/package.json` (currently the `e59eb105` archive URL)
- `cco-code-agent/package.json` (currently the `6cd14208` archive URL)

- [ ] **Step 1: Check what each repo overrode**

```bash
cd /home/jmart/Dynamic-Site-Builder && git log --oneline -5 -- package.json
cd /home/jmart/cco-code-agent && git log --oneline -5 -- package.json
grep -rn "llm-router" /home/jmart/cco-code-agent/src 2>/dev/null | head -5   # does it use APIs added after 6cd14208?
```
The pin exists to freeze behaviour; if the repo uses APIs whose signatures changed after its commit, that is a finding to report — do not silently paper over it.

- [ ] **Step 2: Bump to `^0.21.1`, install, typecheck, test**

```bash
npm install && npm ls @cloud-computing-oy/llm-router && npm run typecheck --if-present && npm test --if-present
```
Expected: 0.21.1 installed; typecheck/test outcome recorded verbatim.

- [ ] **Step 3: Commit, PR, merge** — `chore(deps): pin llm-router by version, not commit archive`, then the gates.

---

### Task 8: Record the new reality

**Files:**
- Modify: `~/.claude/projects/-home-jmart/memory/cco-llm-router.md`
- Modify: `~/.claude/projects/-home-jmart/memory/wip-kimi-k3.md`

- [ ] **Step 1:** In `cco-llm-router.md`, replace the "TS-kuluttajan pinna" and consumer sections with: consumers on `^0.21.1`; Python consumers install the `py-v0.8.1` release asset; no vendor copies remain; release tags `py-v*` drive the wheel.
- [ ] **Step 2:** In `wip-kimi-k3.md`, drop the "Router-kopiot" open item and note the completed consolidation with the two remaining open decisions (data residency, `auto:code`).
