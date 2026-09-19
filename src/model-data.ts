import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { DEFAULT_ALIASES } from "./aliases";

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
      pricing: z
        .object({
          inputPerM: z.number(),
          outputPerM: z.number(),
          // Peak-hour rates; absent for flat-rate providers. See pricing.ts.
          peak: z.object({ inputPerM: z.number(), outputPerM: z.number() }).optional(),
        })
        .optional(),
    }),
  ),
});
export type ModelDataDataset = z.infer<typeof ModelDataSchema>;

function bundledDataPath(): string {
  // esbuild's CJS bundle (build:cli → dist/*.cjs) has __dirname and an
  // empty import.meta.url; tsx/ESM runs have import.meta.url only.
  if (typeof __dirname !== "undefined") {
    return path.join(__dirname, "..", "data", "model-data.json");
  }
  return fileURLToPath(new URL("../data/model-data.json", import.meta.url));
}

export function loadBundledDataset(): ModelDataDataset {
  const raw = fs.readFileSync(bundledDataPath(), "utf8");
  const parsed = ModelDataSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(`bundled model-data.json is invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}

// Lazy: bundlers (Next.js transpilePackages) inline __dirname to a
// build-time placeholder, so reading the file at module evaluation threw
// ENOENT during page-data collection in consumer builds.
let live: ModelDataDataset | null = null;

export function getLiveDataset(): ModelDataDataset {
  return ensureLive();
}

function ensureLive(): ModelDataDataset {
  if (!live) live = initialDataset();
  return live;
}

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

function emptyDataset(): ModelDataDataset {
  return { schemaVersion: SUPPORTED_SCHEMA_VERSION, generatedAt: new Date(0).toISOString(), models: [] };
}

/**
 * Initial dataset for the live snapshot. Returns the loaded dataset, or an
 * empty one when loading fails (unreadable/invalid bundle file) — an empty
 * dataset reproduces pre-dataset behavior: see router.hasReviewedPricing
 * (MODEL_CATALOG fallback) and pricing.priceOf (static PRICING fallback).
 */
export function initialDataset(load: () => ModelDataDataset = loadBundledDataset): ModelDataDataset {
  try {
    return load();
  } catch (err) {
    status.lastError = (err as Error).message;
    return emptyDataset();
  }
}

function isRetiredIn(dataset: ModelDataDataset, provider: string, model: string): boolean {
  return dataset.models.some((m) => m.provider === provider && m.model === model && m.status === "retired");
}

function wouldBrickDefaultChains(next: ModelDataDataset): boolean {
  for (const chain of Object.values(DEFAULT_ALIASES)) {
    const availableNow = chain.filter((s) => !isRetiredIn(ensureLive(), s.provider, s.model));
    if (availableNow.length === 0) continue;
    const availableNext = chain.filter((s) => !isRetiredIn(next, s.provider, s.model));
    if (availableNext.length === 0) return true;
  }
  return false;
}

export function applyDataset(dataset: ModelDataDataset): { ok: true } | { ok: false; reason: string } {
  // Public API: validate shape even though the parameter is typed — callers
  // may pass untyped/malformed data (codex P2).
  const parsed = ModelDataSchema.safeParse(dataset);
  if (!parsed.success) {
    return { ok: false, reason: `invalid dataset shape: ${parsed.error.issues[0]?.message ?? "schema"}` };
  }
  const ds = parsed.data;
  if (ds.schemaVersion > SUPPORTED_SCHEMA_VERSION) {
    return { ok: false, reason: `schemaVersion ${ds.schemaVersion} > supported ${SUPPORTED_SCHEMA_VERSION}` };
  }
  if (wouldBrickDefaultChains(ds)) {
    return { ok: false, reason: "refusing: dataset retires all hops of an active default chain" };
  }
  live = ds;
  status.appliedAt = new Date().toISOString();
  status.lastError = null;
  return { ok: true };
}

export async function refreshNow(opts: { url?: string; fetchImpl?: typeof fetch } = {}): Promise<ModelDataStatus> {
  const url = opts.url ?? process.env.CCO_MODEL_DATA_URL ?? DEFAULT_MODEL_DATA_URL;
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = ModelDataSchema.safeParse(await res.json());
    if (!parsed.success) throw new Error(`invalid dataset: ${parsed.error.message}`);
    const r = applyDataset(parsed.data);
    if (!r.ok) throw new Error(r.reason);
    status.source = "remote";
    status.fetchedAt = new Date().toISOString();
    status.datasetAgeHours = Math.max(0, (Date.now() - Date.parse(parsed.data.generatedAt)) / 3_600_000);
    if ((status.datasetAgeHours ?? 0) > 7 * 24) {
      console.warn(`[cco-llm-router] model data is ${Math.round(status.datasetAgeHours! / 24)} days old — CI may be down`);
    }
    return getModelDataStatus();
  } catch (err) {
    status.lastError = (err as Error).message;
    // Recompute age from the live dataset even when the refresh failed —
    // otherwise a stale dataset with failing refreshes never triggers the
    // age warning (the CI/network-down scenario the warning exists for).
    const ageMs = Date.now() - Date.parse(ensureLive().generatedAt);
    status.datasetAgeHours = Number.isFinite(ageMs) ? Math.max(0, ageMs / 3_600_000) : null;
    if ((status.datasetAgeHours ?? 0) > 7 * 24) {
      console.warn(`[cco-llm-router] model data is ${Math.round(status.datasetAgeHours! / 24)} days old and refreshes are failing — CI may be down`);
    }
    return getModelDataStatus();
  }
}

const MAX_REFRESH_HOURS = 596; // below Node's ~596.5 h interval clamp
export function clampRefreshHours(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  return Math.min(Math.max(raw, 0), MAX_REFRESH_HOURS);
}

let timer: NodeJS.Timeout | null = null;

export function startModelDataRefresh(opts: { url?: string; refreshHours?: number; fetchImpl?: typeof fetch } = {}): void {
  if (timer) return;
  const hours = clampRefreshHours(opts.refreshHours ?? Number(process.env.CCO_MODEL_DATA_REFRESH_HOURS ?? 6));
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

// Auto-start polling at import unless explicitly disabled.
if (process.env.CCO_MODEL_DATA_REFRESH_HOURS !== "0") {
  startModelDataRefresh();
}
