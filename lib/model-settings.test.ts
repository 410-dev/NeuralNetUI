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
  visionImageMode: "max-resolution",
  visionMaxEdgePixels: 1024,
  imageGeneration: true,
  imageInput: false,
  reasoningPresets: [{ id: "high", name: "High", kind: "builtin", effort: "high", ownerId: "private-preset-owner" }],
  ownerId: "private-model-owner",
  connectionId: "private-connection-id",
};

test("model settings export is two-space JSON and strips ownership metadata", () => {
  const text = serializeModelSettings([model], { modelId: model.id, reasoningPresetId: "high" }, new Date("2026-09-01T00:00:00.000Z"));
  assert.match(text, /\n  "version": 1,/);
  assert.match(text, /\n    "modelId": "served-model"/);
  assert.doesNotMatch(text, /ownerId/);
  assert.doesNotMatch(text, /connectionId|private-connection-id/);
  assert.equal(parseModelSettings(text).models[0].reasoningPresets[0].effort, "high");
  assert.equal(parseModelSettings(text).models[0].visionImageMode, "max-resolution");
  assert.equal(parseModelSettings(text).models[0].visionMaxEdgePixels, 1024);
  assert.equal(parseModelSettings(text).models[0].imageGeneration, true);
  assert.equal(parseModelSettings(text).models[0].imageInput, false);
});

test("model settings import rejects unknown fields and unsupported formats", () => {
  const valid = JSON.parse(serializeModelSettings([model], {}, new Date("2026-09-01T00:00:00.000Z")));
  assert.throws(() => parseModelSettings(JSON.stringify({ ...valid, unexpected: true })));
  assert.throws(() => parseModelSettings(JSON.stringify({ ...valid, version: 2 })));
});
