import "./test-ollama-env";
import assert from "node:assert/strict";
import test from "node:test";
import { ModelDataSchema, SUPPORTED_SCHEMA_VERSION, loadBundledDataset, initialDataset, getLiveDataset, applyDataset, refreshNow, startModelDataRefresh, stopModelDataRefresh, getModelDataStatus, clampRefreshHours } from "./model-data";
import { createRouter, DEFAULT_ALIASES, type PerCallKeys } from "./router";

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

test("schema preserves peak rates on dataset pricing", () => {
  const ds = {
    schemaVersion: 1,
    generatedAt: "2026-09-10T00:00:00Z",
    models: [
      {
        provider: "deepseek",
        model: "deepseek-flash",
        status: "available",
        pricing: { inputPerM: 0.15, outputPerM: 0.6, peak: { inputPerM: 0.3, outputPerM: 1.2 } },
      },
    ],
  };
  assert.deepEqual(ModelDataSchema.parse(ds).models[0].pricing, {
    inputPerM: 0.15,
    outputPerM: 0.6,
    peak: { inputPerM: 0.3, outputPerM: 1.2 },
  });
});

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

test("startModelDataRefresh stays disabled for non-finite refresh hours", () => {
  stopModelDataRefresh();
  const old = process.env.CCO_MODEL_DATA_REFRESH_HOURS;
  const noopFetch = async () => new Response("{}");
  // env path: a non-numeric value must not arm a runaway timer
  process.env.CCO_MODEL_DATA_REFRESH_HOURS = "abc";
  startModelDataRefresh({ fetchImpl: noopFetch });
  assert.equal(getModelDataStatus().polling, false);
  // opts path: explicit NaN disables even when the env var names a valid interval
  process.env.CCO_MODEL_DATA_REFRESH_HOURS = "6";
  startModelDataRefresh({ refreshHours: Number.NaN, fetchImpl: noopFetch });
  assert.equal(getModelDataStatus().polling, false);
  if (old === undefined) delete process.env.CCO_MODEL_DATA_REFRESH_HOURS;
  else process.env.CCO_MODEL_DATA_REFRESH_HOURS = old;
});

test("clampRefreshHours caps the poll interval below Node's 1ms clamp threshold", () => {
  assert.equal(clampRefreshHours(720), 596);
  assert.equal(clampRefreshHours(Number.NaN), 0);
  assert.equal(clampRefreshHours(6), 6);
});

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
  // per-call key keeps the chain resolvable even with no env keys; the
  // retired hop itself is supplied the key so the assertion is meaningful
  const { specs } = router.resolveModel(alias, { perCallKeys: { google: "test-key" } });
  assert.ok(!specs.some((s) => s.provider === "google" && s.model === "gemini-2.5-flash"));
});

test("no-provider error names retired hops and points at CCO_MODEL_DATA_URL", () => {
  const dataset = {
    schemaVersion: 1,
    generatedAt: "2026-09-10T00:00:00Z",
    models: [{ provider: "google", model: "gemini-2.5-flash", status: "retired" as const }],
  };
  assert.equal(applyDataset(dataset).ok, true);
  const router = createRouter({
    aliases: { "test:retired-only": [{ provider: "google" as const, model: "gemini-2.5-flash" }] },
  });
  assert.throws(
    () => router.resolveModel("test:retired-only"),
    /No available provider.*1 hop\(s\) retired by model data; check CCO_MODEL_DATA_URL/,
  );
});

test("dataset-absent local hops keep pre-feature reviewed-pricing behavior (ollama)", () => {
  // spec §7.8: local providers stay available; the pricing filter must not
  // drop hops absent from both the live dataset and the static PRICING table.
  const router = createRouter({
    aliases: { "test:ollama-only": [{ provider: "ollama" as const, model: "qwen2.5:14b" }] },
  });
  // PerCallKeys excludes 'ollama' at the type level, but isAvailable checks
  // per-call keys at runtime before falling back to provider env availability.
  const options = { perCallKeys: { ollama: "test-key" } as unknown as PerCallKeys };
  const { specs } = router.resolveModel("test:ollama-only", options);
  assert.deepEqual(specs, [{ provider: "ollama", model: "qwen2.5:14b" }]);
});

test("catalog-priced hops absent from PRICING keep their reviewed status", () => {
  // ollama:gemma3:27b is MODEL_CATALOG pricing:'free' and absent from the
  // static PRICING table — the catalog fallback's non-'unknown' branch.
  const router = createRouter({
    aliases: { "test:gemma-local": [{ provider: "ollama" as const, model: "gemma3:27b" }] },
  });
  const options = { perCallKeys: { ollama: "test-key" } as unknown as PerCallKeys };
  const { specs } = router.resolveModel("test:gemma-local", options);
  assert.deepEqual(specs, [{ provider: "ollama", model: "gemma3:27b" }]);
});

test("catalog pricing:'unknown' hops still require allowUnknownPricing", () => {
  // Pins the pre-feature rejection: mistral:mistral-large-latest is catalog
  // pricing:'unknown' and absent from PRICING — reviewed-pricing filtering
  // rejects it exactly as before the dataset feature.
  const router = createRouter({
    aliases: { "test:mistral-only": [{ provider: "mistral" as const, model: "mistral-large-latest" }] },
  });
  assert.throws(
    () => router.resolveModel("test:mistral-only", { perCallKeys: { mistral: "test-key" } }),
    /No reviewed-price provider/,
  );
});

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

test("applyDataset rejects malformed datasets from untyped callers", () => {
  const bad = { schemaVersion: 1, generatedAt: "x" }; // models missing
  const r = applyDataset(bad as never);
  assert.equal(r.ok, false);
});

test("initialDataset falls back to an empty dataset when loading throws", () => {
  const fallback = initialDataset(() => {
    throw new Error("ENOENT");
  });
  assert.deepEqual(fallback, {
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    generatedAt: new Date(0).toISOString(),
    models: [],
  });
  // The fallback must be a schema-valid dataset: consumers (applyDataset,
  // getLiveDataset) treat it as one, so an unreadable bundle degrades to
  // pre-dataset behavior instead of throwing on import.
  assert.equal(ModelDataSchema.safeParse(fallback).success, true);
});

test("initialDataset returns the real bundled dataset by default", () => {
  const loaded = initialDataset();
  assert.equal(loaded.schemaVersion, SUPPORTED_SCHEMA_VERSION);
  assert.ok(loaded.models.length > 0);
  assert.deepEqual(loaded, loadBundledDataset());
});

test("getLiveDataset stays lazy but still returns the cached reference, and applyDataset swaps it", () => {
  const first = getLiveDataset();
  assert.equal(getLiveDataset(), first); // cached: no reload per call
  assert.deepEqual(applyDataset(goodDataset), { ok: true });
  const swapped = getLiveDataset();
  assert.notEqual(swapped, first);
  assert.equal(swapped.models.length, goodDataset.models.length);
});

test("refreshNow failure recomputes dataset age from the live dataset", async () => {
  const orig = console.warn;
  console.warn = () => {};
  try {
    const fakeFetch = async () => { throw new Error("network down"); };
    const st = await refreshNow({ url: "https://x.test/md.json", fetchImpl: fakeFetch });
    assert.ok(st.datasetAgeHours !== null);
  } finally {
    console.warn = orig;
  }
});
