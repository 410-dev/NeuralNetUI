import assert from "node:assert/strict";
import test from "node:test";
import type { ToolProviderManifest } from "./catalog.ts";
import { resolveTools, specFromModelTool, toModelTool } from "./registry.ts";
import { normalizeToolState } from "./state.ts";
import type { ToolProvider, ToolProviderSource, ToolRequestContext } from "./types.ts";

function manifest(id: string, extra: Partial<ToolProviderManifest> = {}): ToolProviderManifest {
  return { id, origin: "builtin", section: "agent", order: 0, icon: "wrench", label: { en: id, ko: id }, description: { en: id, ko: id }, defaultEnabled: true, functions: [], ...extra };
}
const fn = (name: string) => ({ name, label: { en: name, ko: name }, description: { en: name, ko: name } });
const spec = (name: string, sourceName?: string) => ({ name, description: name, inputSchema: { type: "object", properties: {} }, ...(sourceName ? { sourceName } : {}) });

function request(overrides: Partial<ToolRequestContext> = {}): ToolRequestContext {
  return {
    userId: "u1", role: "user", conversationId: "c1", locale: "en", signal: new AbortController().signal,
    config: {} as unknown as ToolRequestContext["config"],
    model: {} as ToolRequestContext["model"], history: () => [], services: { complete: async () => ({ text: "" }) },
    ...overrides,
  };
}
const source = (...providers: ToolProvider[]): ToolProviderSource => ({ id: "test", providers: () => providers });
const callBits = { callId: "call", rawArguments: "{}", updateEvent: () => undefined, waitForUser: async () => undefined, setWaitPhase: () => undefined };

test("specs convert to and from the model's tool format without loss", () => {
  const original = { name: "lookup", description: "Find things", inputSchema: { type: "object", properties: { q: { type: "string" } } } };
  assert.deepEqual(specFromModelTool(toModelTool(original)), original);
});

test("only enabled providers whose requirements hold are offered", async () => {
  const on: ToolProvider = { manifest: manifest("on", { functions: [fn("on_tool")] }), tools: () => [spec("on_tool")], execute: async () => ({ result: "on" }) };
  const off: ToolProvider = { manifest: manifest("off", { defaultEnabled: false, functions: [fn("off_tool")] }), tools: () => [spec("off_tool")], execute: async () => ({ result: "off" }) };
  const gated: ToolProvider = { manifest: manifest("gated", { functions: [fn("gated_tool")], requires: { role: "superadmin" } }), tools: () => [spec("gated_tool")], execute: async () => ({ result: "gated" }) };
  const unavailable: ToolProvider = { manifest: manifest("plan", { functions: [fn("plan_tool")] }), available: () => false, tools: () => [spec("plan_tool")], execute: async () => ({ result: "plan" }) };
  const resolved = await resolveTools(request(), normalizeToolState(undefined), [source(on, off, gated, unavailable)]);
  assert.deepEqual(resolved.definitions.map(item => (item.function as { name: string }).name), ["on_tool"]);
  await assert.rejects(resolved.execute("gated_tool", {}, callBits), /not enabled/);
  const admin = await resolveTools(request({ role: "superadmin" }), normalizeToolState(undefined), [source(gated)]);
  assert.equal(admin.has("gated_tool"), true);
});

test("undeclared, malformed and duplicate function names are dropped, first provider wins", async () => {
  const first: ToolProvider = { manifest: manifest("first", { functions: [fn("shared"), fn("bad name")] }), tools: () => [spec("shared"), spec("bad name"), spec("sneaky")], execute: async () => ({ result: "first" }) };
  const second: ToolProvider = { manifest: manifest("second", { functions: [], functionPrefix: "x_" }), tools: () => [spec("x_ok"), spec("shared")], execute: async () => ({ result: "second" }) };
  const resolved = await resolveTools(request(), normalizeToolState(undefined), [source(first, second)]);
  assert.deepEqual(resolved.definitions.map(item => (item.function as { name: string }).name), ["shared", "x_ok"]);
  assert.deepEqual(resolved.rejected.map(item => `${item.provider}:${item.name}`).sort(), ["first:bad name", "first:sneaky", "second:shared"]);
  assert.deepEqual(await resolved.execute("shared", {}, callBits), { result: "first" });
});

test("a chat's function selection filters by the provider's own names and options reach the provider", async () => {
  let seenOptions: unknown;
  const mcp: ToolProvider = {
    manifest: manifest("mcp:one", { origin: "user", section: "mcp", defaultEnabled: false, functionPrefix: "mcp_abcd1234_", options: undefined }),
    tools: ctx => { seenOptions = ctx.options; return [spec("mcp_abcd1234_search", "search"), spec("mcp_abcd1234_delete", "delete")]; },
    execute: async () => ({ result: "ok" }),
  };
  const state = normalizeToolState({ version: 2, providers: { "mcp:one": { enabled: true, options: { depth: 2 }, functions: ["search"] } } });
  const resolved = await resolveTools(request(), state, [source(mcp)]);
  assert.deepEqual(resolved.definitions.map(item => (item.function as { name: string }).name), ["mcp_abcd1234_search"]);
  assert.deepEqual(seenOptions, { depth: 2 });
});

test("authorization can refuse a call, and model release follows the provider flag", async () => {
  let executed = false;
  const guarded: ToolProvider = {
    manifest: manifest("guarded", { functions: [fn("guarded_tool")] }), releasesModelWhileRunning: true,
    tools: () => [spec("guarded_tool")],
    authorize: async (_name, args) => args.allow ? { approved: true } : { approved: false, result: { rejected: true } },
    execute: async () => { executed = true; return { result: "ran" }; },
  };
  const resolved = await resolveTools(request(), normalizeToolState(undefined), [source(guarded)]);
  assert.equal(resolved.releasesModel("guarded_tool"), true);
  assert.deepEqual(await resolved.execute("guarded_tool", {}, callBits), { result: { rejected: true } });
  assert.equal(executed, false);
  assert.deepEqual(await resolved.execute("guarded_tool", { allow: true }, callBits), { result: "ran" });
});

test("a plan can switch off a built-in tool", async () => {
  const { toolRequirementsMet, builtinToolProvider } = await import("./catalog.ts");
  const search = builtinToolProvider("web-search")!;
  assert.equal(toolRequirementsMet(search, {}), true);
  assert.equal(toolRequirementsMet(search, { disabledTools: ["web-search"] }), false);
  assert.equal(toolRequirementsMet({ ...search, origin: "user" }, { disabledTools: ["web-search"] }), true);
});

test("a call can redefine its own provider's tools for the rest of the reply, never another provider's", async () => {
  const mine: ToolProvider = {
    manifest: manifest("mine", { functions: [fn("details"), fn("search")] }),
    tools: () => [spec("details"), spec("search")],
    execute: async () => ({ result: "ok", define: [{ name: "search", description: "full", inputSchema: { type: "object", properties: { q: { type: "string" } } } }, { name: "other", description: "taken", inputSchema: {} }] }),
  };
  const theirs: ToolProvider = { manifest: manifest("theirs", { functions: [fn("other")] }), tools: () => [spec("other")], execute: async () => ({ result: "x" }) };
  const resolved = await resolveTools(request(), normalizeToolState(undefined), [source(mine, theirs)]);
  const describe = (name: string) => (resolved.definitions.find(item => (item.function as { name: string }).name === name)!.function as { description: string }).description;
  assert.equal(describe("search"), "search");
  await resolved.execute("details", {}, callBits);
  assert.equal(describe("search"), "full");
  assert.equal(describe("other"), "other");
});
