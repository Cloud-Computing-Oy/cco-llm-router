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
