import assert from "node:assert/strict";
import test from "node:test";
import { inferenceEndpoint, loadedModelIdentifier } from "./inference-control.ts";

test("inferenceEndpoint replaces a trailing OpenAI v1 path", () => {
  assert.equal(
    inferenceEndpoint("http://localhost:8888/v1", "unload"),
    "http://localhost:8888/api/inference/unload",
  );
});

test("inferenceEndpoint preserves a base path and removes query and hash", () => {
  assert.equal(
    inferenceEndpoint("https://example.com/studio/v1/?token=secret#section", "status"),
    "https://example.com/studio/api/inference/status",
  );
});

test("loadedModelIdentifier prefers the loadable model identifier", () => {
  assert.equal(
    loadedModelIdentifier({
      model_identifier: "owner/model:Q4_K_M",
      active_model: "Model display name",
      loaded: ["fallback/model"],
    }),
    "owner/model:Q4_K_M",
  );
});

test("loadedModelIdentifier supports older inference status shapes", () => {
  assert.equal(loadedModelIdentifier({ active_model: "owner/active-model" }), "owner/active-model");
  assert.equal(loadedModelIdentifier({ loaded: ["owner/loaded-model"] }), "owner/loaded-model");
});

test("loadedModelIdentifier ignores malformed or empty status values", () => {
  assert.equal(loadedModelIdentifier({ model_identifier: "  ", loaded: [42, ""] }), undefined);
  assert.equal(loadedModelIdentifier(null), undefined);
});
