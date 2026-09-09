import assert from "node:assert/strict";
import test from "node:test";
import { nativeEligibility, sdkCredentials, progressEvent, nativeHistory } from "./inference-progress.ts";

test("native inference never drops unsupported reasoning semantics", () => {
  assert.equal(nativeEligibility([{ role: "user", content: "hello" }], "off"), true);
  assert.equal(nativeEligibility([], "high"), false);
  assert.equal(nativeEligibility([{ role: "assistant", content: "answer", reasoning_content: "private history" }], "on"), false);
});
test("progress accepts documented event values only", () => {
  assert.deepEqual(progressEvent({ type: "prompt_processing.progress", progress: .43 }), { phase: "processing-prompt", progress: .43 });
  assert.deepEqual(progressEvent({ type: "model_load.end" }), { phase: "loading-model", progress: 1 });
  for (const value of [-1, 101, NaN, Infinity, "50"]) assert.equal(progressEvent({ type: "model_load.progress", progress: value }), undefined);
  assert.equal(progressEvent({ usage: { prompt_tokens: 400 } }), undefined);
});
test("SDK auth uses only the selected connection token", () => {
  assert.deepEqual(sdkCredentials(undefined), {});
  assert.equal(sdkCredentials("Bearer arbitrary"), undefined);
  assert.deepEqual(sdkCredentials("Bearer sk-lm-abcdefgh:12345678901234567890"), { clientIdentifier: "abcdefgh", clientPasskey: "12345678901234567890" });
});
test("native history preserves roles, tool IDs and image parts", async () => {
  const history = await nativeHistory([
    { role: "system", content: "rules" },
    { role: "user", content: [{ type: "text", text: "look" }, { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } }] },
    { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "clock", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "c1", content: "noon" },
  ], async () => ({ type: "file", identifier: "image1", name: "image.png", sizeBytes: 5, fileType: "image" }));
  assert.equal(history[0].role, "system");
  assert.equal(history[1].content[1].type, "file");
  assert.deepEqual(history[2].content[0], { type: "toolCallRequest", toolCallRequest: { id: "c1", type: "function", name: "clock", arguments: {} } });
  assert.deepEqual(history[3].content[0], { type: "toolCallResult", content: "noon", toolCallId: "c1" });
  await assert.rejects(nativeHistory([{ role: "user", content: [{ type: "image_url", image_url: { url: "http://example.com/image" } }] }], async () => { throw Error("must not fetch"); }));
});
