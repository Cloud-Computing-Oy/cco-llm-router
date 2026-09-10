import fs from "node:fs";
import { z } from "zod";

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
