import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSamplingParams, readPersonalSampling, refreshSamplingDefaults, resolveSampling, samplingFromServer, samplingRequestFields, samplingSdkConfig } from "./sampling-params.ts";

test("values outside their range, blanks and non-numbers are dropped", () => {
  assert.deepEqual(normalizeSamplingParams({ topK: "40", topP: 1.5, minP: "", repeatPenalty: 1.1, presencePenalty: -3, extra: 1 }), { topK: 40, repeatPenalty: 1.1 });
  assert.equal(normalizeSamplingParams({ topP: "" }), undefined);
  assert.deepEqual(normalizeSamplingParams({ topK: 12.6 }), { topK: 13 });
});

test("layers win field by field, and personal values count only while accounts may change them", () => {
  const input = { served: { samplingParams: { topK: 20, topP: .8 } }, alias: { samplingParams: { topP: .9 } }, preset: { id: "fast", samplingParams: { minP: .1 } }, modelId: "m", personal: { m: { base: { topK: 50 }, presets: { fast: { minP: .2 }, other: { topP: .1 } } } } };
  assert.deepEqual(resolveSampling(input), { topK: 20, topP: .9, minP: .1 });
  assert.deepEqual(resolveSampling({ ...input, userEditable: true }), { topK: 50, topP: .9, minP: .2 });
  assert.deepEqual(resolveSampling({ modelId: "x" }), {});
});

test("requests carry only set values, in the OpenAI-compatible and LM Studio shapes", () => {
  assert.deepEqual(samplingRequestFields({ topK: 40, minP: .05 }), { top_k: 40, min_p: .05 });
  assert.deepEqual(samplingSdkConfig({ repeatPenalty: 1.1, topP: .9 }), { topPSampling: .9, repeatPenalty: 1.1 });
});

test("server defaults are read from llama.cpp and LM Studio shapes", () => {
  assert.deepEqual(samplingFromServer({ top_k: 40, top_p: .95, min_p: .05, repeat_penalty: 1, presence_penalty: 0 }), { topK: 40, topP: .95, minP: .05, repeatPenalty: 1, presencePenalty: 0 });
  assert.deepEqual(samplingFromServer({ topKSampling: 20, topPSampling: .8, minPSampling: false, repeatPenalty: false, presencePenalty: 0 }), { topK: 20, topP: .8, minP: 0, repeatPenalty: 1, presencePenalty: 0 });
  assert.equal(samplingFromServer(undefined), undefined);
});

test("a refresh follows new defaults only where the value was untouched", () => {
  assert.deepEqual(refreshSamplingDefaults({ topK: 20, topP: .5 }, { topK: 20, topP: .8 }, { topK: 40, topP: .9, minP: .05 }), { topK: 40, topP: .5, minP: .05 });
  assert.deepEqual(refreshSamplingDefaults({ topK: 20 }, { topK: 20 }, undefined), { topK: 20 });
  assert.equal(refreshSamplingDefaults(undefined, undefined, undefined), undefined);
});

test("personal values keep only well-formed entries", () => {
  assert.deepEqual(readPersonalSampling({ m: { base: { topK: 5, topP: 9 }, presets: { p: { minP: .1 }, q: {} } }, n: {}, "": { base: { topK: 1 } } }), { m: { base: { topK: 5 }, presets: { p: { minP: .1 } } } });
});
