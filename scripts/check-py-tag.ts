/**
 * Guards the python-release workflow: a wheel must never be published under a
 * version it does not carry. Run from the repo root.
 */
import fs from "node:fs";

export function checkTag(tag: string, pyprojectVersion: string): { ok: true } | { ok: false; reason: string } {
  const match = /^py-v(\d+\.\d+\.\d+)$/.exec(tag);
  if (!match) return { ok: false, reason: `tag "${tag}" is not of the form py-vX.Y.Z` };
  if (match[1] !== pyprojectVersion) {
    return { ok: false, reason: `tag version ${match[1]} != py/pyproject.toml ${pyprojectVersion}` };
  }
  return { ok: true };
}

if (process.argv[1]?.endsWith("check-py-tag.ts")) {
  const tag = process.argv[2] ?? "";
  const pyproject = fs.readFileSync("py/pyproject.toml", "utf8");
  const version = /^version = "([^"]+)"/m.exec(pyproject)?.[1] ?? "";
  const result = checkTag(tag, version);
  if (!result.ok) {
    console.error(`check-py-tag: ${result.reason}`);
    process.exit(1);
  }
  console.log(`check-py-tag: ${tag} matches py/pyproject.toml`);
}
