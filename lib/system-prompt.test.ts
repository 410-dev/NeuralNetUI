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

test("a chat's prompt beats the account's, which beats the server default, only where the model allows it", async () => {
  const { resolveSystemPrompt, readModelSystemPrompts, canPersonalizeSystemPrompt } = await import("./system-prompt.ts");
  const model = { systemPrompt: "server" };
  const preset = { id: "deep", kind: "custom" as const, systemPrompt: "think hard", systemPromptMode: "append" as const };
  assert.equal(resolveSystemPrompt({ model, selectedId: "m", preset, allowed: true }), "server\n\nthink hard");
  assert.equal(resolveSystemPrompt({ model, selectedId: "m", preset, allowed: true, personal: "mine" }), "mine\n\nthink hard");
  assert.equal(resolveSystemPrompt({ model, selectedId: "m", preset, allowed: true, personal: "mine", session: { m: { deep: " chat only " } } }), "chat only");
  assert.equal(resolveSystemPrompt({ model, selectedId: "m", preset, allowed: true, personal: "mine", session: { m: { other: "x" } } }), "mine\n\nthink hard", "a chat prompt for another preset does not apply");
  assert.equal(resolveSystemPrompt({ model, selectedId: "m", preset, allowed: false, personal: "mine", session: { m: { deep: "chat" } } }), "server\n\nthink hard");
  assert.equal(canPersonalizeSystemPrompt({ isAlias: false, systemPromptEditable: false }, "user"), false);
  assert.equal(canPersonalizeSystemPrompt({ isAlias: false, systemPromptEditable: false }, "admin"), true);
  assert.equal(canPersonalizeSystemPrompt({ isAlias: true }, "user"), true);
  // Saved per-preset replacements from before become the account prompt where one had no preset.
  assert.deepEqual(readModelSystemPrompts({ systemPromptOverrides: { m: { __none__: "old", deep: "x" }, n: { deep: "y" } } }), { m: "old" });
  assert.deepEqual(readModelSystemPrompts({ modelSystemPrompts: { m: "new", n: "  " }, systemPromptOverrides: { m: { __none__: "old" } } }), { m: "new" });
});
