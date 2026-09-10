import fs from "node:fs";
import { pathToFileURL } from "node:url";

// Availability check for every remote provider directory under src/providers/,
// with two deliberate exclusions:
//   - ollama: local provider, never part of the dataset (spec §7.8) — no check.
//   - openai-compatible: shared helper module (createOpenAICompatibleProvider),
//     not a provider with its own API — no check.
// google-paid is covered by the `google` check below: Google's paid tier is
// key-based and the same API serves both — there is no separate list-models
// endpoint to hit.
//
// Endpoints and env key names mirror the router's own provider files
// (src/providers/*.ts); endpoints verified against provider docs 2026-09-10.

export type AvailabilityReport = Record<string, { ok: boolean; models: string[] }>;

type AuthKind = "bearer" | "anthropic" | "google";

type ProviderCheck = {
  name: string;
  endpoint: string;
  keyEnv: string;
  /** Back-compat alias checked when keyEnv is unset (google's GEMINI_API_KEY). */
  keyEnvAlt?: string;
  /** Defaults to "bearer". */
  auth?: AuthKind;
  parse: (json: any) => string[];
};

function authHeaders(auth: AuthKind | undefined, key: string): Record<string, string> {
  switch (auth) {
    case "anthropic":
      return { "x-api-key": key, "anthropic-version": "2023-06-01" };
    case "google":
      // Header instead of `?key=` so the key never lands in URLs/logs.
      return { "x-goog-api-key": key };
    default:
      return { Authorization: `Bearer ${key}` };
  }
}

const CHECKS: ProviderCheck[] = [
  {
    name: "google",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
    // Provider primary env name (src/providers/google.ts), with the brief's
    // back-compat alias as fallback.
    keyEnv: "GOOGLE_GENERATIVE_AI_API_KEY",
    keyEnvAlt: "GEMINI_API_KEY",
    auth: "google",
    parse: (j) => j.models?.map((m: any) => m.name.replace(/^models\//, "")).filter(Boolean) ?? [],
  },
  { name: "openai", endpoint: "https://api.openai.com/v1/models", keyEnv: "OPENAI_API_KEY", parse: (j) => j.data?.map((m: any) => m.id) ?? [] },
  { name: "anthropic", endpoint: "https://api.anthropic.com/v1/models", keyEnv: "ANTHROPIC_API_KEY", auth: "anthropic", parse: (j) => j.data?.map((m: any) => m.id) ?? [] },
  { name: "groq", endpoint: "https://api.groq.com/openai/v1/models", keyEnv: "GROQ_API_KEY", parse: (j) => j.data?.map((m: any) => m.id) ?? [] },
  { name: "openrouter", endpoint: "https://openrouter.ai/api/v1/models", keyEnv: "OPENROUTER_API_KEY", parse: (j) => j.data?.map((m: any) => m.id) ?? [] },
  { name: "deepseek", endpoint: "https://api.deepseek.com/models", keyEnv: "DEEPSEEK_API_KEY", parse: (j) => j.data?.map((m: any) => m.id) ?? [] },
  { name: "moonshot", endpoint: "https://api.moonshot.ai/v1/models", keyEnv: "MOONSHOT_API_KEY", parse: (j) => j.data?.map((m: any) => m.id) ?? [] },
  { name: "dashscope", endpoint: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models", keyEnv: "DASHSCOPE_API_KEY", parse: (j) => j.data?.map((m: any) => m.id) ?? [] },
  { name: "zai", endpoint: "https://api.z.ai/api/paas/v4/models", keyEnv: "ZAI_API_KEY", parse: (j) => j.data?.map((m: any) => m.id) ?? [] },
  { name: "minimax", endpoint: "https://api.minimax.io/v1/models", keyEnv: "MINIMAX_API_KEY", parse: (j) => j.data?.map((m: any) => m.id) ?? [] },
  { name: "mistral", endpoint: "https://api.mistral.ai/v1/models", keyEnv: "MISTRAL_API_KEY", parse: (j) => j.data?.map((m: any) => m.id) ?? [] },
  { name: "nvidia", endpoint: "https://integrate.api.nvidia.com/v1/models", keyEnv: "NVIDIA_API_KEY", parse: (j) => j.data?.map((m: any) => m.id) ?? [] },
  { name: "together", endpoint: "https://api.together.xyz/v1/models", keyEnv: "TOGETHER_API_KEY", parse: (j) => j.data?.map((m: any) => m.id) ?? [] },
  { name: "deepinfra", endpoint: "https://api.deepinfra.com/v1/openai/models", keyEnv: "DEEPINFRA_API_KEY", parse: (j) => j.data?.map((m: any) => m.id) ?? [] },
];

const TIMEOUT_MS = 15_000;

export async function checkProviderModels(checks: ProviderCheck[] = CHECKS): Promise<AvailabilityReport> {
  const report: AvailabilityReport = {};
  for (const check of checks) {
    const key = process.env[check.keyEnv] ?? (check.keyEnvAlt ? process.env[check.keyEnvAlt] : undefined);
    if (!key) {
      // No key -> { ok: false } so the dataset builder carries the previous
      // state over instead of marking everything retired.
      report[check.name] = { ok: false, models: [] };
      continue;
    }
    try {
      const res = await fetch(check.endpoint, {
        headers: authHeaders(check.auth, key),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`${check.name}: HTTP ${res.status}`);
      const json = await res.json();
      report[check.name] = { ok: true, models: check.parse(json) };
    } catch (err) {
      console.error(`${check.name}: check failed: ${err instanceof Error ? err.message : String(err)}`);
      report[check.name] = { ok: false, models: [] };
    }
  }
  // google-paid is the same API under a paid billing tier (src/providers/google-paid.ts):
  // mirror google's report so google-paid entries retire in lockstep with google.
  const google = report.google;
  if (google) report["google-paid"] = { ok: google.ok, models: google.models };
  return report;
}

async function main(): Promise<void> {
  const report = await checkProviderModels();
  await fs.promises.writeFile("availability.json", JSON.stringify(report, null, 2) + "\n");
  let okCount = 0;
  for (const [name, r] of Object.entries(report)) {
    if (r.ok) okCount++;
    console.log(`check-provider-models: ${name}: ${r.ok ? `ok (${r.models.length} models)` : "unavailable — state will carry over"}`);
  }
  console.log(`check-provider-models: ${okCount}/${Object.keys(report).length} providers ok, wrote availability.json`);
  if (okCount === 0) {
    // All providers unreachable / keyless: fail the run so health is not
    // mistaken for a partial success (CI must not look green on total outage).
    console.error("check-provider-models: no provider checks succeeded");
    process.exitCode = 1;
  }
}

// Run only when executed directly; safe to import (e.g. from tests).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
