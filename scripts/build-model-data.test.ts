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

test("mergeDataset carryover preserves model ids containing colons", () => {
  const availability: AvailabilityReport = { openrouter: { ok: true, models: [] } };
  const previous: PreviousState = {
    schemaVersion: 1,
    generatedAt: "2026-09-01T00:00:00Z",
    models: [{ provider: "openrouter", model: "auto:free", status: "available" }],
  };
  const merged = mergeDataset(availability, [], previous);
  const kept = merged.models.find((m) => m.model === "auto:free");
  assert.ok(kept, "exact model id preserved");
  assert.equal(kept.status, "retired");
  assert.ok(!merged.models.some((m) => m.model === "auto"), "no truncated phantom entry");
});

test("mergeDataset adds newly seen models with pricing when available", () => {
  const availability: AvailabilityReport = { google: { ok: true, models: ["gemini-3.1-p"] } };
  const pricing = [{ provider: "google", model: "gemini-3.1-p", pricing: { inputPerM: 2.5, outputPerM: 10 } }];
  const merged = mergeDataset(availability, pricing, { schemaVersion: 1, generatedAt: "x", models: [] });
  const g = merged.models.find((m) => m.model === "gemini-3.1-p")!;
  assert.equal(g.status, "available");
  assert.deepEqual(g.pricing, { inputPerM: 2.5, outputPerM: 10 });
});
