import assert from "node:assert/strict";
import test from "node:test";
import { resolvedQuota } from "./quota-defaults.ts";

test("zero quota values inherit the current workspace default", () => {
  assert.deepEqual(resolvedQuota(0, { bytes:8, usesDefault:false }, 512), { bytes:512, usesDefault:true });
  assert.deepEqual(resolvedQuota(256, { bytes:8, usesDefault:true }, 512), { bytes:256, usesDefault:false });
});

test("an omitted quota preserves both the effective value and inheritance state", () => {
  assert.deepEqual(resolvedQuota(undefined, { bytes:512, usesDefault:true }, 1024), { bytes:512, usesDefault:true });
  assert.deepEqual(resolvedQuota(undefined, { bytes:256, usesDefault:false }, 1024), { bytes:256, usesDefault:false });
});
