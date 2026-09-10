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

test("mergeDataset emits models in deterministic provider:model order", () => {
  const availability: AvailabilityReport = {
    openai: { ok: true, models: ["gpt-z"] },
    google: { ok: true, models: ["z-flash", "a-flash"] },
  };
  const merged = mergeDataset(availability, [], { schemaVersion: 1, generatedAt: "x", models: [] });
  assert.deepEqual(
    merged.models.map((m) => `${m.provider}:${m.model}`),
    ["google:a-flash", "google:z-flash", "openai:gpt-z"],
  );
});

test("carryover applies current pricing.json prices over previous pricing", () => {
  const availability: AvailabilityReport = { openai: { ok: false, models: [] } };
  const pricing = [{ provider: "openai", model: "gpt-5", pricing: { inputPerM: 9, outputPerM: 9 } }];
  const previous: PreviousState = {
    schemaVersion: 1,
    generatedAt: "2026-09-01T00:00:00Z",
    models: [{ provider: "openai", model: "gpt-5", status: "available", pricing: { inputPerM: 3, outputPerM: 15 } }],
  };
  const merged = mergeDataset(availability, pricing, previous);
  assert.deepEqual(merged.models.find((m) => m.model === "gpt-5")!.pricing, { inputPerM: 9, outputPerM: 9 });
});

test("curated pricing.json carries DeepSeek peak rates into the dataset", async () => {
  const fs = await import("node:fs/promises");
  const pricing = JSON.parse(await fs.readFile("data/pricing.json", "utf8")) as {
    models: Array<{ provider: string; model: string; pricing: { inputPerM: number; outputPerM: number; peak?: { inputPerM: number; outputPerM: number } } }>;
  };
  // The nightly model-data job merges pricing.json into the published dataset;
  // without the peak block here, the bundled snapshot regains stale flat rates
  // and priceOf() would silently outrank the peak-aware table.
  for (const model of ["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-pro"]) {
    const entry = pricing.models.find((m) => m.provider === "deepseek" && m.model === model);
    assert.ok(entry, `pricing.json is missing ${model}`);
    assert.deepEqual(entry.pricing, {
      inputPerM: 0.15,
      outputPerM: 0.6,
      peak: { inputPerM: 0.3, outputPerM: 1.2 },
    });
  }
});
