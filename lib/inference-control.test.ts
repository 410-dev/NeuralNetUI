import assert from "node:assert/strict";
import test from "node:test";
import { inferenceEndpoint } from "./inference-control.ts";

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
