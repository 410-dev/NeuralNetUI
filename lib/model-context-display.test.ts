import assert from "node:assert/strict";
import test from "node:test";
import { contextUsageDisplayLimitTokens } from "./model-context.ts";
import type { ModelConfig } from "./types.ts";

const model: ModelConfig = { id: "base", sourceModel: "base", name: "Base", isAlias: false, visible: true, reasoningSupported: false, connectionId: "local", reasoningPresets: [], contextWindowTokens: 262144 };

test("context donut reaches 100% at the configured compaction trigger", () => {
  assert.equal(contextUsageDisplayLimitTokens(model, [model], { contextMode: "compacting", compactThreshold: 50 }), 131072);
  assert.equal(contextUsageDisplayLimitTokens(model, [model], { contextMode: "compacting", compactThreshold: 80 }), 209715);
});

test("rolling mode and absent context limits retain the full model window behavior", () => {
  assert.equal(contextUsageDisplayLimitTokens(model, [model], { contextMode: "rolling", compactThreshold: 50 }), 262144);
  assert.equal(contextUsageDisplayLimitTokens(model, [model]), 262144);
  assert.equal(contextUsageDisplayLimitTokens(undefined, [], { contextMode: "compacting", compactThreshold: 50 }), undefined);
});
