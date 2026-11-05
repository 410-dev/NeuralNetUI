import assert from "node:assert/strict";
import test from "node:test";
import { aliasBaseModel, aliasFallbackBase, aliasWithBaseModel } from "./alias-base-model.ts";
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
  assert.deepEqual(runtime.reasoningPresets.map(preset => preset.id), ["custom"]);
  assert.equal(runtime.reasoningPresets.find(preset => preset.id === "custom")?.systemPrompt, "Careful");
  assert.equal(alias.sourceModel, first.sourceModel, "the saved recommendation remains unchanged");
});

test("an alias whose preferred base is unavailable runs on the next available base in order", () => {
  const third = served("third", "low", "server-c");
  const ordered = [first, second, third];
  assert.equal(aliasFallbackBase(first, ordered, ordered), first);
  assert.equal(aliasFallbackBase(first, ordered, [third]), third);
  assert.equal(aliasFallbackBase(first, ordered, [second, third]), second);
  assert.equal(aliasFallbackBase(third, ordered, [first, second]), first, "the order wraps around");
  assert.equal(aliasFallbackBase(undefined, ordered, [second]), second);
  assert.equal(aliasFallbackBase(first, ordered, []), undefined);
});
