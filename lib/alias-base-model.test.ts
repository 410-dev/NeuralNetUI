import assert from "node:assert/strict";
import test from "node:test";
import { aliasBaseModel, aliasWithBaseModel } from "./alias-base-model.ts";
import type { ModelConfig } from "./types.ts";

const served = (id: string, effort: string, connectionId: string): ModelConfig => ({
  id, name: id, sourceModel: `served/${id}`, connectionId, isAlias: false, visible: true,
  reasoningSupported: true, reasoningEfforts: [effort], reasoningPresets: [{ id: effort, name: effort, kind: "builtin", effort }],
});
const first = served("first", "low", "server-a");
const second = served("second", "high", "server-b");
const alias: ModelConfig = {
  id: "alias", name: "Alias", sourceModel: first.sourceModel, connectionId: first.connectionId,
  isAlias: true, visible: true, reasoningSupported: true, reasoningEfforts: ["low"],
  reasoningPresets: [{ id: "low", name: "Low", kind: "builtin", effort: "low" }, { id: "custom", name: "Custom", kind: "custom", systemPrompt: "Careful" }],
};

test("an explicit alias base overrides the persisted recommendation", () => {
  assert.equal(aliasBaseModel(alias, [first, second], second.id), second);
  assert.equal(aliasBaseModel(alias, [first, second])?.id, first.id);
});

test("a runtime alias follows the selected base connection and native reasoning while preserving custom prompts", () => {
  const runtime = aliasWithBaseModel(alias, second);
  assert.equal(runtime.sourceModel, second.sourceModel);
  assert.equal(runtime.connectionId, second.connectionId);
  assert.deepEqual(runtime.reasoningEfforts, ["high"]);
  assert.deepEqual(runtime.reasoningPresets.map(preset => preset.id).sort(), ["custom", "high"]);
  assert.equal(runtime.reasoningPresets.find(preset => preset.id === "custom")?.systemPrompt, "Careful");
  assert.equal(alias.sourceModel, first.sourceModel, "the saved recommendation remains unchanged");
});
