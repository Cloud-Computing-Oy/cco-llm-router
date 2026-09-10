import fs from "node:fs";

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
    // Split on the FIRST colon only: model ids may themselves contain colons
    // (e.g. OpenRouter "auto:free"), so key.split(":") would truncate the id
    // in the carryover path and create phantom entries.
    const i = key.indexOf(":");
    const provider = key.slice(0, i);
    const model = key.slice(i + 1);
    const report = availability[provider];
    const isRetired = report?.ok === true; // successful check + absent = retired
    // Prices are curated data — always prefer the current pricing.json value
    // (a pricing PR must reach carried-over models even when the provider
    // check fails); fall back to the previous price only if pricing.json
    // has no entry for the model.
    const carryPricing = priceOf(provider, model) ?? prev.pricing;
    models.push({
      provider,
      model,
      status: isRetired ? "retired" : prev.status, // carryover on failed check
      ...(isRetired ? { retiredAt: today } : {}),
      ...(carryPricing ? { pricing: carryPricing } : {}),
    });
  }
  // Deterministic order keeps the nightly commit-back diff quiet.
  models.sort((a, b) => (a.provider + ":" + a.model).localeCompare(b.provider + ":" + b.model));
  return { schemaVersion: 1, generatedAt: today, models };
}

// CLI entry — exported so tests can import this module without side effects;
// scripts/build-model-data-cli.ts is the thin wrapper that actually runs it.
// All paths are cwd-relative; CI runs from the repo root.
const AVAILABILITY_PATH = "availability.json";
const PRICING_PATH = "data/pricing.json";
const MODEL_DATA_PATH = "data/model-data.json";

export async function main(): Promise<void> {
  const availability = JSON.parse(await fs.promises.readFile(AVAILABILITY_PATH, "utf8")) as AvailabilityReport;
  const pricing = (JSON.parse(await fs.promises.readFile(PRICING_PATH, "utf8")) as { models: PricingEntry[] }).models;
  const previous = JSON.parse(await fs.promises.readFile(MODEL_DATA_PATH, "utf8")) as PreviousState;
  const merged = mergeDataset(availability, pricing, previous);
  await fs.promises.writeFile(MODEL_DATA_PATH, JSON.stringify(merged, null, 2) + "\n");
  console.log(`build-model-data: wrote ${MODEL_DATA_PATH} (${merged.models.length} models)`);
}
