import assert from "node:assert/strict";
import test from "node:test";

import { checkTag } from "./check-py-tag";

test("accepts a py-v tag matching pyproject", () => {
  assert.deepEqual(checkTag("py-v0.8.1", "0.8.1"), { ok: true });
});

test("rejects a tag whose version differs from pyproject", () => {
  const r = checkTag("py-v0.8.2", "0.8.1");
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.reason : "", /0\.8\.2.*0\.8\.1/);
});

test("rejects a tag that is not py-vX.Y.Z", () => {
  assert.equal(checkTag("v0.21.1", "0.8.1").ok, false);
  assert.equal(checkTag("py-v0.8", "0.8.1").ok, false);
});
