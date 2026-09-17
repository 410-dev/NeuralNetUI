import assert from "node:assert/strict";
import test from "node:test";
import { applyModelSettingsImage, modelSettingsImage, readModelSettingsLeniently } from "./model-settings-backup.ts";
import type { ModelConfig } from "./types.ts";

const served = (id: string, patch: Partial<ModelConfig> = {}): ModelConfig => ({ id, name: id, sourceModel: `org/${id}`, isAlias: false, visible: true, reasoningSupported: true, reasoningEfforts: ["low", "high"], reasoningPresets: [{ id: "high", name: "High", kind: "builtin", effort: "high" }], connectionId: "c1", ...patch });
const alias = (id: string, ownerId: string, patch: Partial<ModelConfig> = {}): ModelConfig => ({ ...served(id), sourceModel: "org/base", isAlias: true, ownerId, reasoningPresets: [{ id: `${id}-t`, name: "Mine", kind: "custom", ownerId }], ...patch });

test("backup model settings carry only what the owner may see, with ownership", () => {
  const models = [served("base", { reasoningPresets: [{ id: "high", name: "High", kind: "builtin" }, { id: "p-own", name: "Own", kind: "custom", ownerId: "u1" }, { id: "p-other", name: "Other", kind: "custom", ownerId: "u2" }] }), alias("a-own", "u1"), alias("a-private", "u2"), alias("a-public", "u2", { isPublic: true })];
  const image = modelSettingsImage(models, { id: "u1", admin: false }, { modelId: "a-own" });
  const settings = image.settings as { format: string; models: ModelConfig[]; defaults: { modelId?: string } };
  assert.equal(settings.format, "neuralnetui-model-settings");
  assert.deepEqual(settings.models.map((model) => model.id), ["base", "a-own", "a-public"]);
  assert.deepEqual(settings.models[0].reasoningPresets.map((preset) => preset.id), ["high", "p-own"]);
  assert.doesNotMatch(JSON.stringify(settings), /ownerId|connectionId/);
  assert.deepEqual(image.ownedModelIds, ["a-own"]);
  assert.deepEqual(image.ownedPresets, [{ modelId: "base", presetId: "p-own" }, { modelId: "a-own", presetId: "a-own-t" }]);
  assert.equal(settings.defaults.modelId, "a-own");
});

test("a standard account restores its own aliases and nothing served", () => {
  const source = [served("base"), alias("mine", "old-user"), alias("taken", "old-user"), alias("shared", "other", { isPublic: true })];
  const image = modelSettingsImage(source, { id: "old-user", admin: false }, { modelId: "taken" });
  (image.settings as { models: ModelConfig[] }).models[0].name = "Renamed served";
  const destination = [served("base"), alias("taken", "someone-else"), alias("stale", "u9"), alias("shared", "other", { isPublic: true })];
  const merged = applyModelSettingsImage(destination, image, { id: "u9", admin: false }, "merge")!;
  const renamed = merged.idMap.get("taken")!;
  assert.match(renamed, /^alias-[0-9a-f]{24}$/);
  assert.equal(applyModelSettingsImage(destination, image, { id: "u9", admin: false }, "merge")!.idMap.get("taken"), renamed);
  assert.equal(merged.models.find((model) => model.id === "base")!.name, "base");
  assert.equal(merged.models.find((model) => model.id === "taken")!.ownerId, "someone-else");
  assert.deepEqual(merged.models.filter((model) => model.ownerId === "u9").map((model) => model.id).sort(), ["mine", renamed, "stale"].sort());
  assert.equal(merged.models.find((model) => model.id === "mine")!.reasoningPresets[0].ownerId, "u9");
  assert.equal(merged.models.filter((model) => model.id === "shared").length, 1);
  assert.equal(merged.defaults.modelId, renamed);
  assert.deepEqual(merged.report, { aliases: 2, presets: 0, servedModels: 0, skipped: 0 });
  const replaced = applyModelSettingsImage(destination, image, { id: "u9", admin: false }, "replace")!;
  assert.equal(replaced.models.some((model) => model.id === "stale"), false);
});

test("an administrator also restores served-model settings that this workspace serves", () => {
  const source = [served("second"), served("first", { name: "First renamed", description: "Saved", visible: false, contextWindowTokens: 8192, visionImageMode: "max-resolution", visionMaxEdgePixels: 2048, reasoningPresets: [{ id: "high", name: "Deep", kind: "builtin", effort: "high", systemPrompt: "Think" }, { id: "mine", name: "Mine", kind: "custom", ownerId: "admin" }] }), served("gone")];
  const image = modelSettingsImage(source, { id: "admin", admin: true }, {});
  const destination = [served("first-new-id", { sourceModel: "org/first", reasoningEfforts: ["low"], reasoningPresets: [{ id: "high", name: "High", kind: "builtin", effort: "high" }, { id: "other", name: "Other", kind: "custom", ownerId: "u2" }, { id: "stale", name: "Stale", kind: "custom", ownerId: "admin2" }] }), served("second")];
  const result = applyModelSettingsImage(destination, image, { id: "admin2", admin: true }, "replace")!;
  const first = result.models.find((model) => model.id === "first-new-id")!;
  assert.deepEqual(result.models.map((model) => model.id), ["second", "first-new-id"]);
  assert.equal(first.name, "First renamed"); assert.equal(first.visible, false); assert.equal(first.contextWindowTokens, 8192);
  assert.equal(first.visionImageMode, "max-resolution"); assert.equal(first.visionMaxEdgePixels, 2048);
  assert.deepEqual(first.reasoningEfforts, ["low"], "discovered capabilities are kept");
  assert.deepEqual(first.reasoningPresets.map((preset) => [preset.id, preset.name, preset.ownerId]), [["high", "Deep", undefined], ["other", "Other", "u2"], ["mine", "Mine", "admin2"]]);
  assert.equal(first.reasoningPresets[0].systemPrompt, "Think");
  assert.deepEqual(result.report, { aliases: 0, presets: 1, servedModels: 2, skipped: 1 });
});

test("model settings from other versions restore leniently", () => {
  assert.equal(readModelSettingsLeniently(undefined), undefined);
  assert.equal(readModelSettingsLeniently({ format: "something-else", models: [] }), undefined);
  const parsed = readModelSettingsLeniently({ format: "neuralnetui-model-settings", version: 7, futureField: true, defaults: { modelId: "a", extra: 1 }, models: [
    { id: "a", name: "", sourceModel: "org/a", isAlias: false, newField: { nested: true }, visionMaxEdgePixels: 99999, reasoningPresets: [{ id: "p", kind: "custom", name: "P", systemPromptMode: "later" }, { id: "bad", kind: "unknown" }] },
    { name: "missing id" }, "not a model", { id: "a", sourceModel: "dup" },
  ] })!;
  assert.equal(parsed.models.length, 1);
  assert.equal(parsed.models[0].name, "a");
  assert.equal(parsed.models[0].visionMaxEdgePixels, 8192);
  assert.equal(parsed.models[0].visible, true);
  assert.equal("newField" in parsed.models[0], false);
  assert.deepEqual(parsed.models[0].reasoningPresets, [{ id: "p", name: "P", kind: "custom", systemPromptMode: "append" }]);
  assert.equal(parsed.skipped, 4);
  assert.deepEqual(parsed.defaults, { modelId: "a" });
  assert.equal(applyModelSettingsImage([served("a")], { settings: { models: "broken" } }, { id: "u", admin: true }, "merge"), undefined);
});
