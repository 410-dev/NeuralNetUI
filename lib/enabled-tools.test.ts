import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_ENABLED_TOOLS, normalizeEnabledTools } from "./enabled-tools.ts";

test("saved tool switches override defaults and ignore unknown values", () => {
  assert.deepEqual(normalizeEnabledTools(undefined), DEFAULT_ENABLED_TOOLS);
  const tools = normalizeEnabledTools({ internetSearch: true, storageAccess: false, pageVisit: "yes", unknown: true });
  assert.equal(tools.internetSearch, true);
  assert.equal(tools.storageAccess, false);
  assert.equal(tools.pageVisit, false);
  assert.equal("unknown" in tools, false);
});
