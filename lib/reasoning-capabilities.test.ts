import assert from "node:assert/strict";
import test from "node:test";
import { inferReasoning, normalizeReasoning, inheritReasoning } from "./reasoning-capabilities.ts";
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
  assert.equal(reasoningEffort(inherited, custom), undefined);
  assert.equal(reasoningEffort(inherited, inherited.reasoningPresets.find(p => p.effort === "off")), "none");
  assert.deepEqual({mode:inherited.visionImageMode,pixels:inherited.visionMaxEdgePixels},{mode:"max-resolution",pixels:640});
  assert.equal(inheritReasoning(alias, undefined).reasoningSupported, false);
});
test("unsupported models have Default and never send unadvertised effort", () => {
  const unsupported = normalizeReasoning({ ...model([]), reasoningSupported: false });
  assert.equal(unsupported.reasoningPresets[0].name, "Default");
  assert.equal(reasoningEffort(model([]), { id: "high", name: "High", kind: "custom", effort: "high" }), undefined);
  assert.deepEqual(normalizeReasoning(model(["on"])).reasoningPresets.map(p => p.name), ["Thinking"]);
});
