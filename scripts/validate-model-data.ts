/**
 * Validates data/model-data.json against ModelDataSchema. Used by the
 * model-data workflow as its post-build gate.
 *
 * Runs as a real module (not `node -e`): the eval context makes
 * model-data.ts resolve its bundled snapshot relative to the eval
 * pseudo-module, one directory above the repo root, and the check died
 * with ENOENT before it could validate anything.
 */
import fs from "node:fs";

import { ModelDataSchema } from "../src/model-data";

const raw = JSON.parse(fs.readFileSync("data/model-data.json", "utf8"));
const result = ModelDataSchema.safeParse(raw);
if (!result.success) {
  console.error(result.error);
  process.exit(1);
}
console.log(`schema OK, ${result.data.models.length} models`);
