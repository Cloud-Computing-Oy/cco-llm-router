import fs from "node:fs";
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

// Auto-start polling at import unless explicitly disabled.
if (process.env.CCO_MODEL_DATA_REFRESH_HOURS !== "0") {
  startModelDataRefresh();
}
