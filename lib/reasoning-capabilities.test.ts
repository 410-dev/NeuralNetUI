import assert from "node:assert/strict";
import test from "node:test";
import { inferReasoning, normalizeReasoning, inheritReasoning, offeredPresets, FORCED_REASONING_EFFORTS } from "./reasoning-capabilities.ts";
import { reasoningEffort } from "./model-edits.ts";
import type { ModelConfig } from "./types.ts";

const model = (options: string[]): ModelConfig => ({ id: "base", sourceModel: "base", name: "Base", isAlias: false, visible: true, reasoningSupported: true, reasoningEfforts: options, reasoningPresets: [] });
test("toggle-only models get Fast and Thinking; effort models omit redundant Thinking", () => {
  assert.deepEqual(normalizeReasoning(model(["off", "on"])).reasoningPresets.map(p => [p.name, p.effort]), [["Fast", "off"], ["Thinking", "on"]]);
  assert.deepEqual(normalizeReasoning(model(["off", "low", "medium", "xhigh", "on"])).reasoningPresets.map(p => p.name), ["Fast", "Low", "Medium", "Extra High"]);
});
test("explicit metadata overrides family fallbacks, including disabled and empty capabilities", () => {
  assert.deepEqual(inferReasoning({ capabilities: { reasoning: { allowed_options: ["off", "on"] } } }, "qwen3.8-uncensored", "lmstudio").reasoningEfforts, ["off", "on"]);
  for (const record of [{ reasoning_supported: false }, { capabilities: { reasoning: false } }, { capabilities: { reasoning: { allowed_options: [] } } }]) {
    assert.equal(inferReasoning(record, "qwen3.8", "lmstudio").reasoningSupported, false);
  }
  assert.deepEqual(inferReasoning({}, "gemma4-31b", "openai").reasoningEfforts, ["off", "on"]);
  assert.deepEqual(inferReasoning({}, "qwen3.8-27b", "openai").reasoningEfforts, ["off", "low", "medium", "xhigh", "on"]);
  assert.equal(inferReasoning({}, "unknown", "lmstudio").reasoningSupported, false);
});
test("aliases follow base capabilities and preserve custom prompt content and ownership", () => {
  const custom = { id: "custom", name: "Custom", kind: "custom" as const, effort: "high", systemPrompt: "Keep me", systemPromptMode: "replace" as const, ownerId: "owner" };
  const alias = { ...model(["high"]), isAlias: true, visionImageMode:"max-resolution" as const, visionMaxEdgePixels:640, reasoningPresets: [custom] };
  const inherited = inheritReasoning(alias, { ...model(["off", "on"]), visionImageMode:"original" as const, visionMaxEdgePixels:2048 });
  assert.deepEqual(inherited.reasoningEfforts, ["off", "on"]);
  assert.deepEqual(inherited.reasoningPresets.find(p => p.id === "custom"), custom);
  assert.equal(reasoningEffort(inherited, custom), "high");
  assert.equal(reasoningEffort(inheritReasoning(alias, undefined), custom), undefined);
  assert.equal(reasoningEffort(inherited, inherited.reasoningPresets.find(p => p.effort === "off")), "none");
  assert.deepEqual({mode:inherited.visionImageMode,pixels:inherited.visionMaxEdgePixels},{mode:"max-resolution",pixels:640});
  assert.equal(inheritReasoning(alias, undefined).reasoningSupported, false);
});
test("unsupported models have Default and send nothing in system prompt mode", () => {
  const unsupported = normalizeReasoning({ ...model([]), reasoningSupported: false });
  assert.equal(unsupported.reasoningPresets[0].name, "Default");
  assert.equal(reasoningEffort(unsupported, { id: "high", name: "High", kind: "custom", effort: "high" }), undefined);
  assert.deepEqual(normalizeReasoning(model(["on"])).reasoningPresets.map(p => p.name), ["Thinking"]);
});
test("forced API mode sends fallback values for models that advertise none, and yields to real metadata", () => {
  const forced = normalizeReasoning({ ...model([]), reasoningSupported: false, reasoningForceApi: true });
  assert.equal(forced.reasoningSupported, true);
  assert.deepEqual(forced.reasoningEfforts, FORCED_REASONING_EFFORTS);
  assert.deepEqual(forced.reasoningPresets.map(p => p.name), ["Default"]);
  assert.equal(reasoningEffort(forced, { id: "t", name: "Deep", kind: "custom", effort: "high" }), "high");
  const advertised = normalizeReasoning({ ...model(["off", "on"]), reasoningForceApi: true });
  assert.equal(advertised.reasoningForceApi, undefined);
  assert.deepEqual(advertised.reasoningEfforts, ["off", "on"]);
});
test("template presets send their typed API value verbatim; built-ins still need advertised values", () => {
  const base = normalizeReasoning(model(["low", "high"]));
  const custom = (effort?: string) => ({ id: "t", name: "Deep", kind: "custom" as const, ...(effort === undefined ? {} : { effort }) });
  assert.equal(reasoningEffort(base, custom(" ultra ")), "ultra");
  assert.equal(reasoningEffort(base, custom("off")), "off");
  assert.equal(reasoningEffort(base, custom("  ")), undefined);
  assert.equal(reasoningEffort({ ...base, reasoningSupported: false }, custom("high")), undefined);
  assert.equal(reasoningEffort(base, { id: "b", name: "Ultra", kind: "builtin", effort: "ultra" }), undefined);
});
test("forced API mode offers only the model's templates, and aliases follow the forced base", () => {
  const template = { id: "t", name: "Deep", kind: "custom" as const, effort: "high" };
  const forced = normalizeReasoning({ ...model([]), reasoningSupported: false, reasoningForceApi: true, reasoningPresets: [template] });
  assert.deepEqual(forced.reasoningPresets.map(p => p.name).sort(), ["Deep", "Default"]);
  assert.deepEqual(offeredPresets(forced).map(p => p.name), ["Deep"]);
  assert.deepEqual(offeredPresets(normalizeReasoning({ ...model([]), reasoningSupported: false, reasoningForceApi: true })).map(p => p.name), ["Default"]);
  const alias = inheritReasoning({ ...model([]), id: "alias", isAlias: true, reasoningPresets: [template] }, forced);
  assert.deepEqual(offeredPresets(alias).map(p => p.name), ["Deep"]);
  assert.equal(reasoningEffort(alias, template), "high");
});
