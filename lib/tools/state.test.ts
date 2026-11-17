import assert from "node:assert/strict";
import test from "node:test";
import { builtinToolProvider, mcpManifest } from "./catalog.ts";
import { clearFunctionSelections, DEFAULT_TOOL_STATE, enabledProviderCount, isLegacyToolState, mergeToolState, normalizeToolState, persistableToolState, requestToolState, resolveProviderState, setProviderFunctions, setProviderOption } from "./state.ts";

const storage = builtinToolProvider("storage")!;

test("providers without an entry use their manifest defaults", () => {
  assert.deepEqual(resolveProviderState(DEFAULT_TOOL_STATE, storage), { enabled: true, options: { read: true, write: false, maxFiles: 5 }, functions: undefined });
  assert.equal(resolveProviderState(DEFAULT_TOOL_STATE, builtinToolProvider("web-search")!).enabled, false);
  assert.equal(resolveProviderState(DEFAULT_TOOL_STATE, builtinToolProvider("artifact")!).enabled, true);
  assert.equal(resolveProviderState(DEFAULT_TOOL_STATE, mcpManifest({ id: "c1", name: "GitHub", url: "https://example.com" })).enabled, false);
});

test("legacy switch objects convert to provider entries", () => {
  const legacy = { internetSearch: true, pageVisit: "yes", storageAccess: false, storageWrite: true, storageWriteMaxFiles: 999, artifact: false, mcpConnectionIds: ["one", 4, "one"], mcpToolNames: { one: ["search", "search", 4, ""], two: ["read"] } };
  assert.equal(isLegacyToolState(legacy), true);
  const state = normalizeToolState(legacy);
  assert.deepEqual(state.providers["web-search"], { enabled: true });
  assert.equal("page-visit" in state.providers, false);
  assert.deepEqual(state.providers.storage, { enabled: false, options: { read: true, write: true, maxFiles: 20 } });
  assert.deepEqual(state.providers.artifact, { enabled: false });
  assert.deepEqual(state.providers["mcp:one"], { enabled: true, functions: ["search"] });
  assert.deepEqual(state.providers["mcp:two"], { enabled: false, functions: ["read"] });
});

test("the provider format keeps unknown providers and drops malformed entries", () => {
  const state = normalizeToolState({ version: 2, providers: {
    "workspace:sandbox": { enabled: true, options: { memoryMb: 256, label: "x", ok: true } },
    "Bad Id": { enabled: true },
    "web-search": { enabled: "yes" },
    storage: { enabled: true, options: { maxFiles: -4, write: 1 } },
  } });
  assert.deepEqual(Object.keys(state.providers).sort(), ["storage", "workspace:sandbox"]);
  assert.deepEqual(state.providers["workspace:sandbox"].options, { memoryMb: 256, ok: true });
  assert.deepEqual(state.providers.storage.options, { read: true, write: false, maxFiles: 1 });
  assert.deepEqual(normalizeToolState("nonsense"), { version: 2, providers: {} });
});

test("merging a patch changes only the providers and fields it names", () => {
  const saved = normalizeToolState({ version: 2, providers: { storage: { enabled: true, options: { read: false, write: true, maxFiles: 9 } }, "web-search": { enabled: true } } });
  const merged = mergeToolState(saved, { version: 2, providers: { storage: { enabled: false } } });
  assert.deepEqual(merged.providers.storage, { enabled: false, options: { read: false, write: true, maxFiles: 9 } });
  assert.deepEqual(merged.providers["web-search"], { enabled: true });
});

test("function selections stay with one chat and are never saved", () => {
  let state = setProviderFunctions(DEFAULT_TOOL_STATE, "mcp:one", ["search"]);
  state = setProviderOption(state, storage, "maxFiles", 7);
  assert.deepEqual(state.providers["mcp:one"], { enabled: false, functions: ["search"] });
  assert.deepEqual(persistableToolState(state).providers["mcp:one"], { enabled: false });
  assert.deepEqual(clearFunctionSelections(state).providers.storage.options, { read: true, write: false, maxFiles: 7 });
  assert.equal(clearFunctionSelections(DEFAULT_TOOL_STATE), DEFAULT_TOOL_STATE);
});

test("the composer badge counts switched-on providers among those offered", () => {
  const offered = [storage, builtinToolProvider("web-search")!, builtinToolProvider("current-time")!];
  assert.equal(enabledProviderCount(DEFAULT_TOOL_STATE, offered), 2);
  assert.equal(enabledProviderCount(normalizeToolState({ version: 2, providers: { storage: { enabled: false } } }), offered), 1);
});

test("chat requests without the provider format keep unrequested built-ins off", () => {
  const none = requestToolState(undefined);
  for (const id of ["storage", "current-time", "multiple-choice", "artifact"]) assert.equal(none.providers[id].enabled, false, id);
  const legacy = requestToolState({ currentTime: true, storageAccess: true, storageWrite: true });
  assert.equal(legacy.providers["current-time"].enabled, true);
  assert.equal(legacy.providers.artifact.enabled, false);
  assert.deepEqual(legacy.providers.storage, { enabled: true, options: { read: false, write: true, maxFiles: 5 } });
  assert.equal(resolveProviderState(requestToolState({ version: 2, providers: {} }), builtinToolProvider("artifact")!).enabled, true);
});
