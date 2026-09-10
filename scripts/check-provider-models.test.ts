import assert from "node:assert/strict";
import test from "node:test";
import { checkProviderModels, summarizeReports, type AvailabilityReport } from "./check-provider-models";

// Dedicated env var so the tests never read or clobber a real provider key.
const KEY_ENV = "CCO_TEST_CHECK_KEY";

const googleCheck = {
  name: "google",
  endpoint: "https://example.test/models",
  keyEnv: KEY_ENV,
  auth: "google" as const,
  parse: (j: any) => (j.models ?? []).map((m: any) => m.name),
};

test("checkProviderModels mirrors the google report into google-paid", async () => {
  process.env[KEY_ENV] = "test-key";
  try {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ models: [{ name: "a" }, { name: "b" }] }), { status: 200 });
    const report = await checkProviderModels([googleCheck], fetchImpl);
    assert.equal(report.google.ok, true);
    assert.deepEqual(report.google.models, ["a", "b"]);
    assert.equal(report["google-paid"].ok, true);
    assert.deepEqual(report["google-paid"].models, ["a", "b"]);
  } finally {
    delete process.env[KEY_ENV];
  }
});

test("checkProviderModels records a failed check when fetch throws", async () => {
  process.env[KEY_ENV] = "test-key";
  try {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("network down");
    };
    const report = await checkProviderModels([googleCheck], fetchImpl);
    assert.deepEqual(report, {
      google: { ok: false, models: [] },
      "google-paid": { ok: false, models: [] },
    });
    // Every check failed: the run must fail rather than look like a partial success.
    assert.equal(summarizeReports(report).exitCode, 1);
  } finally {
    delete process.env[KEY_ENV];
  }
});

test("summarizeReports fails the run only when every check failed", () => {
  const allFailed: AvailabilityReport = {
    google: { ok: false, models: [] },
    "google-paid": { ok: false, models: [] },
  };
  assert.deepEqual(summarizeReports(allFailed), { okCount: 0, exitCode: 1 });

  const partial: AvailabilityReport = { ...allFailed, google: { ok: true, models: ["a"] } };
  assert.deepEqual(summarizeReports(partial), { okCount: 1, exitCode: 0 });
});
