import assert from "node:assert/strict";
import test from "node:test";
import { composeSystemPrompt, readSystemPromptOverrides, systemPromptEditable, systemPromptOverride, withSystemPromptOverride } from "./system-prompt.ts";

test("a preset template is composed with the model prompt by its mode", () => {
  const model = { systemPrompt: " Model rules " };
  assert.equal(composeSystemPrompt(model), "Model rules");
  assert.equal(composeSystemPrompt(model, { kind: "builtin", systemPrompt: "ignored" }), "Model rules");
  assert.equal(composeSystemPrompt(model, { kind: "custom", systemPrompt: "Think", systemPromptMode: "append" }), "Model rules\n\nThink");
  assert.equal(composeSystemPrompt(model, { kind: "custom", systemPrompt: "Think", systemPromptMode: "prepend" }), "Think\n\nModel rules");
  assert.equal(composeSystemPrompt(model, { kind: "custom", systemPrompt: "Think", systemPromptMode: "replace" }), "Think");
  assert.equal(composeSystemPrompt({}, { kind: "custom", systemPrompt: "Think" }), "Think");
});

test("aliases are always editable and served models only when allowed", () => {
  assert.equal(systemPromptEditable({ isAlias: true }), true);
  assert.equal(systemPromptEditable({ isAlias: false }), false);
  assert.equal(systemPromptEditable({ isAlias: false, systemPromptEditable: true }), true);
});

test("overrides are kept per model and preset, and removing the last one drops the model", () => {
  let overrides = withSystemPromptOverride({}, "m", "low", "A");
  overrides = withSystemPromptOverride(overrides, "m", undefined, "B");
  assert.equal(systemPromptOverride(overrides, "m", "low"), "A");
  assert.equal(systemPromptOverride(overrides, "m"), "B");
  assert.equal(systemPromptOverride(overrides, "m", "high"), undefined);
  overrides = withSystemPromptOverride(withSystemPromptOverride(overrides, "m", "low", null), "m", undefined, null);
  assert.deepEqual(overrides, {});
  assert.deepEqual(readSystemPromptOverrides({ m: { a: "x", b: 3 }, n: "bad", o: {} }), { m: { a: "x" } });
});
