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

test("MCP selections are deduplicated, bounded, and reject malformed values", () => {
  const tools = normalizeEnabledTools({ mcpConnectionIds: ["one", "one", 4, "", "two"],mcpToolNames:{one:["search","search",4,""],two:"bad"} });
  assert.deepEqual(tools.mcpConnectionIds, ["one", "two"]);
  assert.deepEqual(tools.mcpToolNames,{one:["search"]});
  assert.deepEqual(normalizeEnabledTools({ mcpConnectionIds: "one" }).mcpConnectionIds, []);
});

test("artifact is enabled by default and can be disabled",()=>{
  assert.equal(normalizeEnabledTools(undefined).artifact,true);
  assert.equal(normalizeEnabledTools({artifact:false}).artifact,false);
});

test("storage permissions default safely and clamp the per-session write limit",()=>{
  const defaults=normalizeEnabledTools(undefined);assert.equal(defaults.storageRead,true);assert.equal(defaults.storageWrite,false);assert.equal(defaults.storageWriteMaxFiles,5);
  assert.equal(normalizeEnabledTools({storageRead:false,storageWrite:true,storageWriteMaxFiles:999}).storageWriteMaxFiles,20);
  assert.equal(normalizeEnabledTools({storageWriteMaxFiles:-4}).storageWriteMaxFiles,1);
});
