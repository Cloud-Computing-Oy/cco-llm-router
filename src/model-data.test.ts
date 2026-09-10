import assert from "node:assert/strict";
import test from "node:test";
import { ModelDataSchema, SUPPORTED_SCHEMA_VERSION, loadBundledDataset, getLiveDataset, applyDataset, refreshNow, startModelDataRefresh, stopModelDataRefresh, getModelDataStatus } from "./model-data";
import { DEFAULT_ALIASES } from "./router";

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
