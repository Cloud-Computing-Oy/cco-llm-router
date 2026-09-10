# Auto-Refreshing Model Data — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a self-refreshing model availability + pricing dataset to cco-llm-router so provider retirements stop breaking chains without a code release.

**Architecture:** Curated chains stay in `router.ts`. A new `model-data.ts` holds a live dataset (bundled snapshot at start, refreshed from a stable URL every 6 h with atomic swap). CI builds `model-data.json` nightly from provider list-models checks + repo-curated `pricing.json` and publishes it as a GitHub release asset under a fixed `model-data` tag. `resolveModel`/`pricing` consult the live dataset.

**Tech Stack:** TypeScript, node:test (`node --import tsx --test src/*.test.ts`), zod (already a dependency), GitHub Actions, Node ≥22.

**Spec:** `docs/superpowers/specs/2026-09-10-router-model-data-design.md`

**Deviation from spec (recorded):** the stable URL uses a dedicated GitHub release tag `model-data` (`releases/download/model-data/model-data.json`) instead of `latest/download` — a fixed tag is robust against unrelated releases. `DEFAULT_URL` follows.

## Global Constraints

- Node ≥22 (`engines` in package.json; `node:test` + `node:assert/strict`, no jest/vitest).
- zod schemas for all external data; unknown `schemaVersion` → reject.
- Env vars: `CCO_MODEL_DATA_URL` (default `https://github.com/Cloud-Computing-Oy/cco-llm-router/releases/download/model-data/model-data.json`), `CCO_MODEL_DATA_REFRESH_HOURS` (default `6`, `0` disables polling).
- Never mutate chains/aliases; data only filters hops and supplies pricing.
- `retired` is the only status that removes a hop; `unknown`/absent = carryover.
- Bricking guard: reject a dataset that retires *all* data-available hops of any default alias chain that currently has ≥1.
- Publish the dataset from the `data/` directory; bundle `data/model-data.json` in the npm package (`files` array).
- Public repo: no secrets in committed files; CI keys from GitHub Actions secrets.

---

### Task 1: Dataset schema + bundled snapshot loading

**Files:**
- Create: `data/pricing.json` (curated prices; initial content mirrors current `src/pricing.ts` `PRICING` table — copy verbatim)
- Create: `data/model-data.json` (bundled snapshot: `status: "available"` for every pricing entry, `schemaVersion: 1`, `generatedAt` fixed string `"1970-01-01T00:00:00Z"` placeholder — CI regenerates)
- Create: `src/model-data.ts` (schema, bundled loader, live dataset accessor)
- Test: `src/model-data.test.ts`

**Interfaces:**
- Produces (used by Tasks 2–4): `ModelDataSchema` (zod), `ModelDataDataset` (type), `SUPPORTED_SCHEMA_VERSION = 1`, `loadBundledDataset(): ModelDataDataset`, `getLiveDataset(): ModelDataDataset`

- [ ] **Step 1: Write the failing test**

`src/model-data.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { ModelDataSchema, SUPPORTED_SCHEMA_VERSION, loadBundledDataset, getLiveDataset } from "./model-data";

test("bundled dataset loads from the package data dir and validates", () => {
  const d = loadBundledDataset();
  assert.equal(d.schemaVersion, SUPPORTED_SCHEMA_VERSION);
  assert.ok(d.models.length > 0);
  assert.ok(d.models.every((m) => m.status === "available" || m.status === "retired"));
});

test("live dataset is initialized to the bundled snapshot at module load", () => {
  assert.equal(getLiveDataset(), getLiveDataset()); // same ref until swapped
  assert.equal(getLiveDataset().schemaVersion, SUPPORTED_SCHEMA_VERSION);
});

test("schema rejects a dataset with an unknown schemaVersion type", () => {
  const bad = { schemaVersion: "1", generatedAt: "x", models: [] };
  assert.equal(ModelDataSchema.safeParse(bad).success, false);
});

test("schema accepts a valid minimal dataset", () => {
  const good = {
    schemaVersion: 1,
    generatedAt: "2026-09-10T00:00:00Z",
    models: [{ provider: "google", model: "gemini-2.5-pro", status: "retired", retiredAt: "2026-09-01", pricing: { inputPerM: 1.25, outputPerM: 5 } }],
  };
  assert.equal(ModelDataSchema.safeParse(good).success, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/model-data.test.ts` — Expected: FAIL (`Cannot find module './model-data'`).

- [ ] **Step 3: Write minimal implementation**

`src/model-data.ts`:

```ts
import fs from "node:fs";
import { z } from "zod";

export const SUPPORTED_SCHEMA_VERSION = 1;

export const ModelDataSchema = z.object({
  schemaVersion: z.number().int(),
  generatedAt: z.string(),
  models: z.array(
    z.object({
      provider: z.string(),
      model: z.string(),
      status: z.enum(["available", "retired"]),
      retiredAt: z.string().optional(),
      pricing: z.object({ inputPerM: z.number(), outputPerM: z.number() }).optional(),
    }),
  ),
});
export type ModelDataDataset = z.infer<typeof ModelDataSchema>;

const BUNDLED_PATH = new URL("../data/model-data.json", import.meta.url);

export function loadBundledDataset(): ModelDataDataset {
  const raw = fs.readFileSync(BUNDLED_PATH, "utf8");
  const parsed = ModelDataSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(`bundled model-data.json is invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}

let live: ModelDataDataset = loadBundledDataset();

export function getLiveDataset(): ModelDataDataset {
  return live;
}
```

`data/pricing.json` — copy of the current `PRICING` table values as JSON:

```json
{
  "models": [
    { "provider": "google", "model": "gemini-2.5-flash", "pricing": { "inputPerM": 0, "outputPerM": 0 } },
    { "provider": "google", "model": "gemini-2.5-pro", "pricing": { "inputPerM": 1.25, "outputPerM": 5 } },
    { "provider": "google-paid", "model": "gemini-2.5-flash", "pricing": { "inputPerM": 0.075, "outputPerM": 0.3 } },
    { "provider": "google-paid", "model": "gemini-2.5-pro", "pricing": { "inputPerM": 1.25, "outputPerM": 5 } },
    { "provider": "openai", "model": "gpt-5-mini", "pricing": { "inputPerM": 0.25, "outputPerM": 2 } },
    { "provider": "openai", "model": "gpt-5", "pricing": { "inputPerM": 3, "outputPerM": 15 } },
    { "provider": "anthropic", "model": "claude-haiku-4-5", "pricing": { "inputPerM": 1, "outputPerM": 5 } },
    { "provider": "anthropic", "model": "claude-sonnet-4-6", "pricing": { "inputPerM": 3, "outputPerM": 15 } }
  ]
}
```

> Executor note: copy the actual values from `src/pricing.ts` `PRICING` verbatim — the list above is illustrative; do not invent prices. Add any model present in `PRICING` that is missing here.

`data/model-data.json` — bundled snapshot: `schemaVersion: 1`, `generatedAt: "1970-01-01T00:00:00Z"`, and one `{"provider","model","status":"available","pricing"}` entry per `data/pricing.json` model.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/model-data.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/model-data.ts src/model-data.test.ts data/pricing.json data/model-data.json package.json
git commit -m "feat(model-data): dataset schema, bundled snapshot, live accessor"
```

Note: `package.json` change in this task = add `"data"` to the `files` array.

---

### Task 2: Atomic swap + background poller + safety rules

**Files:**
- Modify: `src/model-data.ts`
- Test: `src/model-data.test.ts` (extend)

**Interfaces:**
- Consumes: `ModelDataSchema`, `ModelDataDataset`, `SUPPORTED_SCHEMA_VERSION`, `getLiveDataset` (Task 1)
- Produces (used by Tasks 3–4): `applyDataset(dataset): { ok: true } | { ok: false; reason: string }`, `refreshNow(opts?): Promise<ModelDataStatus>`, `startModelDataRefresh(opts?)`, `stopModelDataRefresh()`, `getModelDataStatus()`, `ModelDataStatus` (type), `DEFAULT_MODEL_DATA_URL`

- [ ] **Step 1: Write the failing tests**

Append to `src/model-data.test.ts`:

```ts
import { applyDataset, refreshNow, startModelDataRefresh, stopModelDataRefresh, getModelDataStatus, DEFAULT_MODEL_DATA_URL, DEFAULT_ALIASES } from "./model-data";
import { createRouter } from "./router";

const goodDataset = {
  schemaVersion: 1,
  generatedAt: "2026-09-10T00:00:00Z",
  models: [
    { provider: "google", model: "gemini-2.5-pro", status: "retired" as const },
    { provider: "openai", model: "gpt-5", status: "available" as const, pricing: { inputPerM: 3, outputPerM: 15 } },
  ],
};

test("applyDataset swaps the live reference atomically", () => {
  const before = getLiveDataset();
  const r = applyDataset(goodDataset);
  assert.deepEqual(r, { ok: true });
  assert.notEqual(getLiveDataset(), before);
  assert.equal(getLiveDataset().models[0].status, "retired");
});

test("applyDataset rejects a future schemaVersion", () => {
  const r = applyDataset({ ...goodDataset, schemaVersion: SUPPORTED_SCHEMA_VERSION + 1 });
  assert.equal(r.ok, false);
});

test("applyDataset rejects a dataset that retires all hops of an active default chain", () => {
  // every model in every default chain is retired in this candidate
  const allRetired = {
    schemaVersion: 1,
    generatedAt: "2026-09-10T00:00:00Z",
    models: Object.values(DEFAULT_ALIASES)
      .flat()
      .map((s) => ({ provider: s.provider, model: s.model, status: "retired" as const })),
  };
  assert.equal(applyDataset(allRetired).ok, false);
});

test("refreshNow fetches, validates and applies a dataset", async () => {
  const fakeFetch = async () =>
    new Response(JSON.stringify(goodDataset), { status: 200, headers: { "content-type": "application/json" } });
  const st = await refreshNow({ url: "https://example.test/md.json", fetchImpl: fakeFetch });
  assert.equal(st.source, "remote");
  assert.equal(st.lastError, null);
});

test("refreshNow keeps the previous dataset when the fetch fails", async () => {
  const before = getLiveDataset();
  const fakeFetch = async () => { throw new Error("network down"); };
  const st = await refreshNow({ url: "https://example.test/md.json", fetchImpl: fakeFetch });
  assert.equal(getLiveDataset(), before);
  assert.ok(st.lastError !== null);
});

test("startModelDataRefresh honors CCO_MODEL_DATA_REFRESH_HOURS=0", () => {
  stopModelDataRefresh();
  const old = process.env.CCO_MODEL_DATA_REFRESH_HOURS;
  process.env.CCO_MODEL_DATA_REFRESH_HOURS = "0";
  startModelDataRefresh({ fetchImpl: async () => new Response("{}") });
  assert.equal(getModelDataStatus().polling, false);
  if (old === undefined) delete process.env.CCO_MODEL_DATA_REFRESH_HOURS;
  else process.env.CCO_MODEL_DATA_REFRESH_HOURS = old;
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/model-data.test.ts` — Expected: FAIL (missing exports).

- [ ] **Step 3: Implement**

Extend `src/model-data.ts`:

```ts
import { createRouter } from "./router"; // NOTE: import lazily inside functions to avoid a cycle; see Step 4 note
```

```ts
export const DEFAULT_MODEL_DATA_URL =
  "https://github.com/Cloud-Computing-Oy/cco-llm-router/releases/download/model-data/model-data.json";

export type ModelDataStatus = {
  source: "bundled" | "remote";
  fetchedAt: string | null;
  appliedAt: string | null;
  lastError: string | null;
  polling: boolean;
  datasetAgeHours: number | null;
};

let status: ModelDataStatus = { source: "bundled", fetchedAt: null, appliedAt: null, lastError: null, polling: false, datasetAgeHours: null };

export function getModelDataStatus(): ModelDataStatus {
  return { ...status };
}

function isRetiredIn(dataset: ModelDataDataset, provider: string, model: string): boolean {
  return dataset.models.some((m) => m.provider === provider && m.model === model && m.status === "retired");
}

function wouldBrickDefaultChains(next: ModelDataDataset): boolean {
  const { DEFAULT_ALIASES } = require("./router") as typeof import("./router");
  for (const chain of Object.values(DEFAULT_ALIASES)) {
    const availableNow = chain.filter((s) => !isRetiredIn(live, s.provider, s.model));
    if (availableNow.length === 0) continue;
    const availableNext = chain.filter((s) => !isRetiredIn(next, s.provider, s.model));
    if (availableNext.length === 0) return true;
  }
  return false;
}

export function applyDataset(dataset: ModelDataDataset): { ok: true } | { ok: false; reason: string } {
  if (dataset.schemaVersion > SUPPORTED_SCHEMA_VERSION) {
    return { ok: false, reason: `schemaVersion ${dataset.schemaVersion} > supported ${SUPPORTED_SCHEMA_VERSION}` };
  }
  if (wouldBrickDefaultChains(dataset)) {
    return { ok: false, reason: "refusing: dataset retires all hops of an active default chain" };
  }
  live = dataset;
  status.appliedAt = new Date().toISOString();
  status.lastError = null;
  return { ok: true };
}

export async function refreshNow(opts: { url?: string; fetchImpl?: typeof fetch } = {}): Promise<ModelDataStatus> {
  const url = opts.url ?? process.env.CCO_MODEL_DATA_URL ?? DEFAULT_MODEL_DATA_URL;
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = ModelDataSchema.safeParse(await res.json());
    if (!parsed.success) throw new Error(`invalid dataset: ${parsed.error.message}`);
    const r = applyDataset(parsed.data);
    if (!r.ok) throw new Error(r.reason);
    status.source = "remote";
    status.fetchedAt = new Date().toISOString();
    status.datasetAgeHours = Math.max(0, (Date.now() - Date.parse(parsed.data.generatedAt)) / 3_600_000);
    return getModelDataStatus();
  } catch (err) {
    status.lastError = (err as Error).message;
    return getModelDataStatus();
  }
}

let timer: NodeJS.Timeout | null = null;

export function startModelDataRefresh(opts: { url?: string; refreshHours?: number; fetchImpl?: typeof fetch } = {}): void {
  if (timer) return;
  const hours = opts.refreshHours ?? Number(process.env.CCO_MODEL_DATA_REFRESH_HOURS ?? 6);
  if (hours <= 0) return;
  const url = opts.url ?? process.env.CCO_MODEL_DATA_URL ?? DEFAULT_MODEL_DATA_URL;
  status.polling = true;
  timer = setInterval(() => { void refreshNow({ url, fetchImpl: opts.fetchImpl }); }, hours * 3_600_000);
  timer.unref?.();
}

export function stopModelDataRefresh(): void {
  if (timer) { clearInterval(timer); timer = null; }
  status.polling = false;
}
```

At the bottom of `src/model-data.ts` (after definitions), auto-start unless disabled:

```ts
// Auto-start polling at import unless explicitly disabled.
if (process.env.CCO_MODEL_DATA_REFRESH_HOURS !== "0") {
  startModelDataRefresh();
}
```

> Step 4 note (import cycle): `model-data.ts` needs `DEFAULT_ALIASES` from `router.ts`, and Task 3 makes `router.ts` import from `model-data.ts`. Use a lazy `require()` inside `wouldBrickDefaultChains` (shown above) or move `DEFAULT_ALIASES` to a new `src/aliases.ts` imported by both. Prefer the **`src/aliases.ts` extraction** if the cycle causes test failures: create `src/aliases.ts` exporting `DEFAULT_ALIASES` verbatim from `router.ts`, re-export it from `router.ts` (backward compatible), and import it in `model-data.ts` normally. The executor picks the extraction path if the cycle bites; do not ship a half-working require.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/model-data.test.ts && npm run typecheck` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/model-data.ts src/model-data.test.ts
git commit -m "feat(model-data): atomic swap, poller, safety rules"
```

---

### Task 3: resolveModel + pricing read the live dataset

**Files:**
- Modify: `src/router.ts` (availability + reviewed-pricing filters, improved no-provider error)
- Modify: `src/pricing.ts` (`priceOf`/`estimateCostUSD` prefer live data, static table as fallback)
- Test: `src/router.test.ts` (create if absent) + extend `src/catalog.test.ts`-style coverage in `src/model-data.test.ts`

**Interfaces:**
- Consumes: `getLiveDataset`, `applyDataset` (Tasks 1–2), existing `PRICING`/`priceOf` shape
- Produces: no new public API; behavior change only

- [ ] **Step 1: Write the failing test (retired-hop regression replay)**

In `src/model-data.test.ts` (or a new `src/router.test.ts` if one exists — keep tests in `src/*.test.ts` per the `test` script):

```ts
test("resolveModel skips a retired model mid-chain (gemini-2.5 regression)", () => {
  const dataset = {
    schemaVersion: 1,
    generatedAt: "2026-09-10T00:00:00Z",
    models: [{ provider: "google", model: "gemini-2.5-flash", status: "retired" as const }],
  };
  const applied = applyDataset(dataset);
  assert.equal(applied.ok, true);
  const router = createRouter();
  // find the first default chain that contains gemini-2.5-flash and assert it is filtered
  const chainWithRetired = Object.values(DEFAULT_ALIASES).find((c) =>
    c.some((s) => s.provider === "google" && s.model === "gemini-2.5-flash"),
  );
  assert.ok(chainWithRetired, "test setup: a default chain uses gemini-2.5-flash");
  const alias = Object.entries(DEFAULT_ALIASES).find(([, c]) => c === chainWithRetired)![0];
  const { specs } = router.resolveModel(alias);
  assert.ok(!specs.some((s) => s.provider === "google" && s.model === "gemini-2.5-flash"));
});
```

> Executor note: `resolveModel` may throw `No available provider` if the test environment has no API keys for the chain's remaining hops. If so, assert on the error message instead: it must NOT be the retired model being missing — pass per-call keys (`perCallKeys`) for one provider in the chain to make it resolvable, mirroring existing tests in `catalog.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/model-data.test.ts` — Expected: FAIL (retired hop still in `specs`).

- [ ] **Step 3: Implement**

`src/router.ts` — add at module scope (importing from Task 1's module):

```ts
import { getLiveDataset } from "./model-data";

function isRetired(provider: string, model: string): boolean {
  return getLiveDataset().models.some(
    (m) => m.provider === provider && m.model === model && m.status === "retired",
  );
}
```

Hmm — `isAvailable(p: Provider, ...)` has no model parameter. The filter runs per chain spec, so change the call sites: in `resolveModel`, replace

```ts
const availableByKey = chain.filter((s) => isAvailable(s.provider, perCallKeys));
```

with

```ts
const availableByKey = chain.filter(
  (s) => isAvailable(s.provider, perCallKeys) && !isRetired(s.provider, s.model),
);
```

and in `listAliases` similarly (`chain.filter((s) => providerAvailable(s.provider) && !isRetired(s.provider, s.model))`).

Reviewed-pricing filter: replace `hasReviewedAutomaticPricing` body's source — it currently checks the static `PRICING` table; change it to prefer the live dataset and fall back to `PRICING`:

```ts
function hasReviewedPricing(spec: Spec): boolean {
  const live = getLiveDataset().models.find((m) => m.provider === spec.provider && m.model === spec.model);
  if (live) return live.pricing !== undefined;
  return Object.prototype.hasOwnProperty.call(PRICING, `${spec.provider}:${spec.model}`);
}
```

No-provider error message: in the `available.length === 0` branch, extend the thrown message:

```ts
const retiredCount = chain.filter((s) => isRetired(s.provider, s.model)).length;
throw new Error(
  `No available provider for alias ${alias} — set at least one API key` +
    (retiredCount > 0 ? ` (${retiredCount} hop(s) retired by model data; check CCO_MODEL_DATA_URL)` : ""),
);
```

`src/pricing.ts` — `priceOf` prefers live pricing:

```ts
import { getLiveDataset } from "./model-data";

export function priceOf(provider: Provider, model: string): Price {
  const live = getLiveDataset().models.find((m) => m.provider === provider && m.model === model);
  if (live?.pricing) {
    return { inputPerM: live.pricing.inputPerM, outputPerM: live.pricing.outputPerM };
  }
  const k = `${provider}:${model}` as keyof typeof PRICING;
  return PRICING[k] ?? { inputPerM: 0, outputPerM: 0 };
}
```

Keep the existing static `PRICING` fallback logic intact (adjust only the lookup as shown; preserve the unknown-price sentinel behavior of the current implementation).

- [ ] **Step 4: Run full test suite + typecheck**

Run: `npm test && npm run typecheck` — Expected: PASS (all existing tests still green; no consumer-facing signature changes).

- [ ] **Step 5: Commit**

```bash
git add src/router.ts src/pricing.ts src/model-data.test.ts
git commit -m "feat(model-data): resolveModel and pricing consult the live dataset"
```

---

### Task 4: Public API surface + stale-data warnings

**Files:**
- Modify: `src/index.ts` (exports)
- Modify: `src/model-data.ts` (stale warning on refresh + status)
- Test: `src/model-data.test.ts` (extend)

**Interfaces:**
- Produces (public): `getModelDataStatus`, `startModelDataRefresh`, `stopModelDataRefresh`, `applyDataset`, `ModelDataStatus`, `ModelDataDataset`, `DEFAULT_MODEL_DATA_URL`

- [ ] **Step 1: Write the failing tests**

```ts
test("public API is exported from index", async () => {
  const idx = await import("./index");
  assert.equal(typeof idx.getModelDataStatus, "function");
  assert.equal(typeof idx.startModelDataRefresh, "function");
  assert.equal(typeof idx.stopModelDataRefresh, "function");
  assert.equal(typeof idx.applyDataset, "function");
  assert.equal(typeof idx.DEFAULT_MODEL_DATA_URL, "string");
});

test("refreshNow warns when the dataset is older than 7 days", async () => {
  const old = {
    schemaVersion: 1,
    generatedAt: new Date(Date.now() - 8 * 24 * 3_600_000).toISOString(),
    models: [],
  };
  const fakeFetch = async () =>
    new Response(JSON.stringify(old), { status: 200, headers: { "content-type": "application/json" } });
  const st = await refreshNow({ url: "https://example.test/md.json", fetchImpl: fakeFetch });
  assert.ok((st.datasetAgeHours ?? 0) > 7 * 24);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/model-data.test.ts` — Expected: FAIL (missing exports).

- [ ] **Step 3: Implement**

`src/index.ts` — add to the existing export list:

```ts
export {
  getModelDataStatus,
  startModelDataRefresh,
  stopModelDataRefresh,
  applyDataset,
  DEFAULT_MODEL_DATA_URL,
  type ModelDataStatus,
  type ModelDataDataset,
} from "./model-data";
```

`src/model-data.ts` — in `refreshNow` after applying, emit a warning when the dataset is stale:

```ts
if ((status.datasetAgeHours ?? 0) > 7 * 24) {
  console.warn(`[cco-llm-router] model data is ${Math.round(status.datasetAgeHours! / 24)} days old — CI may be down`);
}
```

(Unit test above asserts on `datasetAgeHours`; the console.warn is a smoke-observable side effect.)

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test && npm run typecheck` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/model-data.ts src/model-data.test.ts
git commit -m "feat(model-data): public API exports and stale-data warnings"
```

---

### Task 5: CI tooling — provider checks + dataset builder

**Files:**
- Create: `scripts/check-provider-models.ts`
- Create: `scripts/build-model-data.ts`
- Test: `scripts/build-model-data.test.ts` (pure merge logic extracted for testability — see Step 1)

**Interfaces:**
- Consumes: `data/pricing.json`, `ModelDataSchema`
- Produces: `availability.json` (intermediate, CI-only), `data/model-data.json` (committed bundle)

- [ ] **Step 1: Write the failing test for the merge logic**

`scripts/build-model-data.test.ts` — the merge must be a pure exported function:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { mergeDataset, type AvailabilityReport, type PreviousState } from "./build-model-data";

test("mergeDataset marks models absent from a successful API check as retired", () => {
  const availability: AvailabilityReport = {
    google: { ok: true, models: ["gemini-3.1-p"] },
  };
  const previous: PreviousState = {
    schemaVersion: 1,
    generatedAt: "2026-09-01T00:00:00Z",
    models: [{ provider: "google", model: "gemini-2.5-pro", status: "available", pricing: { inputPerM: 1.25, outputPerM: 5 } }],
  };
  const merged = mergeDataset(availability, [{ provider: "google", model: "gemini-2.5-pro", pricing: { inputPerM: 1.25, outputPerM: 5 } }], previous);
  const g = merged.models.find((m) => m.model === "gemini-2.5-pro")!;
  assert.equal(g.status, "retired");
  assert.ok(g.retiredAt);
});

test("mergeDataset carries over previous status when the API check failed", () => {
  const availability: AvailabilityReport = { google: { ok: false, models: [] } };
  const previous: PreviousState = {
    schemaVersion: 1,
    generatedAt: "2026-09-01T00:00:00Z",
    models: [{ provider: "google", model: "gemini-2.5-pro", status: "retired" }],
  };
  const merged = mergeDataset(availability, [], previous);
  assert.equal(merged.models.find((m) => m.model === "gemini-2.5-pro")!.status, "retired");
});

test("mergeDataset adds newly seen models with pricing when available", () => {
  const availability: AvailabilityReport = { google: { ok: true, models: ["gemini-3.1-p"] } };
  const pricing = [{ provider: "google", model: "gemini-3.1-p", pricing: { inputPerM: 2.5, outputPerM: 10 } }];
  const merged = mergeDataset(availability, pricing, { schemaVersion: 1, generatedAt: "x", models: [] });
  const g = merged.models.find((m) => m.model === "gemini-3.1-p")!;
  assert.equal(g.status, "available");
  assert.deepEqual(g.pricing, { inputPerM: 2.5, outputPerM: 10 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test scripts/build-model-data.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**

`scripts/build-model-data.ts` — exports pure `mergeDataset` plus a CLI main that reads the files and writes `data/model-data.json`:

```ts
export type AvailabilityReport = Record<string, { ok: boolean; models: string[] }>;
export type PreviousState = { schemaVersion: number; generatedAt: string; models: Array<{ provider: string; model: string; status: "available" | "retired"; retiredAt?: string; pricing?: { inputPerM: number; outputPerM: number } }> };
export type PricingEntry = { provider: string; model: string; pricing: { inputPerM: number; outputPerM: number } };

export function mergeDataset(
  availability: AvailabilityReport,
  pricing: PricingEntry[],
  previous: PreviousState,
): PreviousState {
  const today = new Date().toISOString();
  const priceOf = (provider: string, model: string) =>
    pricing.find((p) => p.provider === provider && p.model === model)?.pricing;
  const previousModels = new Map(previous.models.map((m) => [`${m.provider}:${m.model}`, m]));
  const seen = new Set<string>();

  const models: PreviousState["models"] = [];
  for (const [provider, report] of Object.entries(availability)) {
    for (const model of report.models) {
      const key = `${provider}:${model}`;
      seen.add(key);
      const prev = previousModels.get(key);
      models.push({
        provider,
        model,
        status: "available",
        ...(priceOf(provider, model) ? { pricing: priceOf(provider, model) } : {}),
        ...(prev?.status === "retired" ? { status: "retired" as const, retiredAt: prev.retiredAt } : {}),
      });
    }
  }
  for (const [key, prev] of previousModels) {
    if (seen.has(key)) continue;
    const [provider, model] = key.split(":");
    const report = availability[provider];
    const isRetired = report?.ok === true; // successful check + absent = retired
    models.push({
      provider,
      model,
      status: isRetired ? "retired" : prev.status, // carryover on failed check
      ...(isRetired ? { retiredAt: today } : {}),
      ...(prev.pricing ? { pricing: prev.pricing } : {}),
    });
  }
  return { schemaVersion: 1, generatedAt: today, models };
}
```

CLI `main()` in the same file (guarded by `if (import.meta.url === pathToFileURL(process.argv[1]).href)` — or simpler, export `main()` and add a tiny `scripts/build-model-data-cli.ts` that calls it): reads `availability.json`, `data/pricing.json`, `data/model-data.json` (previous), writes the merged dataset to `data/model-data.json`.

`scripts/check-provider-models.ts` — provider registry + list-models checks. Structure:

```ts
type ProviderCheck = { name: string; endpoint: string; keyEnv?: string; parse: (json: any) => string[] };
const CHECKS: ProviderCheck[] = [
  { name: "google", endpoint: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", keyEnv: "GEMINI_API_KEY", parse: (j) => j.models?.map((m: any) => m.name.replace(/^models\//, "")).filter(Boolean) ?? [] },
  { name: "openai", endpoint: "https://api.openai.com/v1/models", keyEnv: "OPENAI_API_KEY", parse: (j) => j.data?.map((m: any) => m.id) ?? [] },
  { name: "anthropic", endpoint: "https://api.anthropic.com/v1/models", keyEnv: "ANTHROPIC_API_KEY", parse: (j) => j.data?.map((m: any) => m.id) ?? [] },
  { name: "groq", endpoint: "https://api.groq.com/openai/v1/models", keyEnv: "GROQ_API_KEY", parse: (j) => j.data?.map((m: any) => m.id) ?? [] },
  { name: "openrouter", endpoint: "https://openrouter.ai/api/v1/models", keyEnv: "OPENROUTER_API_KEY", parse: (j) => j.data?.map((m: any) => m.id) ?? [] },
  { name: "deepseek", endpoint: "https://api.deepseek.com/models", keyEnv: "DEEPSEEK_API_KEY", parse: (j) => j.data?.map((m: any) => m.id) ?? [] },
  { name: "mistral", endpoint: "https://api.mistral.ai/v1/models", keyEnv: "MISTRAL_API_KEY", parse: (j) => j.data?.map((m: any) => m.id) ?? [] },
  // moonshot, dashscope, zai, minimax, nvidia, together, deepinfra follow the same
  // openai-compatible /models pattern — add them with their documented endpoints.
];
```

> Executor note: verify each endpoint against the provider's current API docs while implementing; adjust headers per provider (google uses `?key=`, anthropic uses `x-api-key` + `anthropic-version: 2023-06-01`, the rest use `Authorization: Bearer`). The pattern above is the shape, not gospel.

Main loop: for each check — if `keyEnv` unset → report `{ ok: false, models: [] }` (carryover); else fetch with 15 s timeout, on success `{ ok: true, models: parse(json) }`, on failure `{ ok: false, models: [] }`. Write `availability.json`.

- [ ] **Step 4: Run tests + typecheck**

Run: `node --import tsx --test scripts/build-model-data.test.ts && npm run typecheck` — Expected: PASS. (Note: `npm test` glob is `src/*.test.ts`; scripts tests run explicitly as shown.)

- [ ] **Step 5: Commit**

```bash
git add scripts/check-provider-models.ts scripts/build-model-data.ts scripts/build-model-data.test.ts
git commit -m "feat(model-data): CI tooling for availability checks and dataset build"
```

---

### Task 6: GitHub Actions workflow — nightly build + release publish

**Files:**
- Create: `.github/workflows/model-data.yml`
- Modify: `package.json` (scripts: `"check:models": "node --import tsx scripts/check-provider-models.ts"`, `"build:model-data": "node --import tsx scripts/build-model-data-cli.ts"`)

**Interfaces:**
- Consumes: Task 5 scripts, repo secrets (add as GitHub Actions secrets: `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`, `MISTRAL_API_KEY` — org-level if available)

- [ ] **Step 1: Write the workflow**

`.github/workflows/model-data.yml`:

```yaml
name: model-data
on:
  schedule:
    - cron: "17 2 * * *"   # nightly, off-peak minute
  workflow_dispatch:
  push:
    paths: ["data/pricing.json", "scripts/check-provider-models.ts", "scripts/build-model-data*.ts"]

permissions:
  contents: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - name: Check provider models
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
          DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
          MISTRAL_API_KEY: ${{ secrets.MISTRAL_API_KEY }}
        run: npm run check:models
      - name: Build dataset
        run: npm run build:model-data
      - name: Validate schema
        run: node --import tsx -e "import('./src/model-data').then(({ ModelDataSchema }) => { const fs = require('fs'); const r = ModelDataSchema.safeParse(JSON.parse(fs.readFileSync('data/model-data.json', 'utf8'))); if (!r.success) { console.error(r.error); process.exit(1); } console.log('schema OK,', r.data.models.length, 'models'); })"
      - name: Publish release asset
        run: |
          gh release create model-data data/model-data.json --title "model-data $(date -u +%F)" --notes "Auto-generated model availability + pricing dataset" --prerelease || true
          gh release upload model-data data/model-data.json --clobber
        env:
          GH_TOKEN: ${{ github.token }}
      - name: Self-check asset URL
        run: |
          curl -fsS https://github.com/${{ github.repository }}/releases/download/model-data/model-data.json -o /tmp/asset.json
          node -e "const d = require('/tmp/asset.json'); if (!Array.isArray(d.models)) process.exit(1); console.log('asset fetch OK')"
```

- [ ] **Step 2: Sanity-check locally (dry parts)**

Run locally: `npm run check:models` with one provider key set (e.g. `GEMINI_API_KEY`) — Expected: `availability.json` written with `google: { ok: true, models: [...] }`. Then `npm run build:model-data` — Expected: `data/model-data.json` regenerated and schema-valid. Do NOT commit a regenerated bundle in this task unless the diff is reviewed (retirements may appear — that is expected and good).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/model-data.yml package.json scripts/build-model-data-cli.ts
git commit -m "ci(model-data): nightly availability checks + dataset release publish"
```

- [ ] **Step 4: First live run (manual)**

Push the branch / trigger `workflow_dispatch` from the GitHub UI. Expected: workflow green, `model-data` release exists, asset URL fetchable. If provider checks misparse any API, fix endpoints in this task before moving on.

---

### Task 7: Documentation + integration verification

**Files:**
- Modify: `README.md` (new "Model data" section)
- Modify: `MIGRATION.md` (note for consumers: opt-out env var)
- Test: integration against the Page Studio harness (external repo)

**Interfaces:**
- Consumes: everything above; Page Studio `scripts/autoresearch/evaluate.ts` (Dynamic-Site-Builder repo)

- [ ] **Step 1: Document**

`README.md` — add:

```markdown
## Model data (availability + pricing)

The router ships a bundled `model-data.json` snapshot and refreshes it
from a stable GitHub release URL every 6 hours by default.

- `CCO_MODEL_DATA_URL` — override the dataset URL (default: this repo's `model-data` release asset)
- `CCO_MODEL_DATA_REFRESH_HOURS` — refresh interval; `0` disables polling entirely

Retired models are skipped at resolve time; prices feed `estimateCostUSD`
and budget gates. `getModelDataStatus()` reports source, last fetch, and errors.
The dataset is rebuilt nightly by CI from provider list-models APIs plus
the curated `data/pricing.json` (prices are updated by PR).
```

`MIGRATION.md` — append a short consumer note: no action required; `CCO_MODEL_DATA_REFRESH_HOURS=0` restores fully static behavior.

- [ ] **Step 2: Integration check with the Page Studio benchmark**

With this branch installed in Page Studio (local `npm install` against the git branch), run the 21-case harness from the Dynamic-Site-Builder repo:

```bash
cd ~/Dynamic-Site-Builder && bash scripts/autoresearch/run.sh
```

Expected: the harness completes; chains that referenced retired google models now skip them silently (visible in the harness's `resolvedModel` capture: no `google:gemini-2.5-*` entries); scores comparable to the pre-change baseline. If results regress hard (all `llm_error`), STOP and debug before release — do not proceed with "it compiles".

- [ ] **Step 3: Version + commit**

Bump `package.json` `version` to `0.21.0`, update CHANGELOG if the repo maintains one, commit:

```bash
git add README.md MIGRATION.md package.json
git commit -m "docs(model-data): consumer docs and 0.21.0 version bump"
```

---

## Self-Review (completed by plan author)

1. **Spec coverage:** §4 schema → Task 1 (schema + bundle); §5 CI pipeline → Tasks 5–6 (checks, merge, validate, publish, self-check URL); §6 runtime → Tasks 1–2 (snapshot, poller, swap) + 3 (resolveModel) + 4 (env vars via `startModelDataRefresh`, status API); §7 rules 1–8 → Task 2 (schemaVersion reject, bricking guard, fetch-failure keep, stale warning in Task 4, carryover in Task 5 merge, retired-only-removal in Task 3 filter, local providers unaffected because data absence = available); §8 testing → each task's tests + Task 7 integration; §9 rollout → Task 7 version bump; consumer bumps happen after merge (not part of this repo's plan).
2. **Placeholder scan:** the executor note in Task 1 tells the implementer to copy `PRICING` verbatim — this is a data-copy instruction, not a placeholder. Endpoint table in Task 5 names concrete URLs for seven providers and directs verification for the remainder; acceptable per the note.
3. **Type consistency:** `ModelDataDataset`, `applyDataset`, `refreshNow`, `getModelDataStatus`, `DEFAULT_MODEL_DATA_URL`, `AvailabilityReport`, `PreviousState`, `mergeDataset` used consistently across tasks.
