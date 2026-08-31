import assert from "node:assert/strict";
import test from "node:test";
import { parseModelSettings, serializeModelSettings } from "./model-settings.ts";
import type { ModelConfig } from "./types.ts";

const model: ModelConfig = {
  id: "served-model",
  name: "Served model",
  sourceModel: "org/served-model",
  isAlias: false,
  visible: true,
  reasoningSupported: true,
  reasoningEfforts: ["low", "high"],
  reasoningPresets: [{ id: "high", name: "High", kind: "builtin", effort: "high", ownerId: "private-preset-owner" }],
  ownerId: "private-model-owner",
};

test("model settings export is two-space JSON and strips ownership metadata", () => {
  const text = serializeModelSettings([model], { modelId: model.id, reasoningPresetId: "high" }, new Date("2026-09-01T00:00:00.000Z"));
  assert.match(text, /\n  "version": 1,/);
  assert.match(text, /\n    "modelId": "served-model"/);
  assert.doesNotMatch(text, /ownerId/);
  assert.equal(parseModelSettings(text).models[0].reasoningPresets[0].effort, "high");
});

test("model settings import rejects unknown fields and unsupported formats", () => {
  const valid = JSON.parse(serializeModelSettings([model], {}, new Date("2026-09-01T00:00:00.000Z")));
  assert.throws(() => parseModelSettings(JSON.stringify({ ...valid, unexpected: true })));
  assert.throws(() => parseModelSettings(JSON.stringify({ ...valid, version: 2 })));
});
