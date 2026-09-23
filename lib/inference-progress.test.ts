import assert from "node:assert/strict";
import test from "node:test";
import { nativeEligibility, sdkCredentials, progressEvent, nativeHistory, pollPromptProcessing } from "./inference-progress.ts";

test("native inference never drops unsupported reasoning semantics", () => {
  assert.equal(nativeEligibility([{ role: "user", content: "hello" }], "off"), true);
  assert.equal(nativeEligibility([], "high"), false);
  assert.equal(nativeEligibility([{ role: "assistant", content: "answer", reasoning_content: "private history" }], "on"), false);
  assert.equal(nativeEligibility([{ role: "assistant", content: "", reasoning_content: "planning", tool_calls: [{ id: "c1" }] }], "on"), true);
});
test("progress accepts documented event values only", () => {
  assert.deepEqual(progressEvent({ type: "prompt_processing.progress", progress: .43 }), { phase: "processing-prompt", progress: .43 });
  assert.deepEqual(progressEvent({ type: "model_load.end" }), { phase: "loading-model", progress: 1 });
  for (const value of [-1, 101, NaN, Infinity, "50"]) assert.equal(progressEvent({ type: "model_load.progress", progress: value }), undefined);
  assert.equal(progressEvent({ usage: { prompt_tokens: 400 } }), undefined);
});
test("model status polling stops at the first observed prompt processing state", async () => {
  const states = ["idle", "idle", "processingPrompt", "generating"];
  let reads = 0; let starts = 0;
  await pollPromptProcessing(new AbortController().signal, async () => states[reads++], () => starts++, 1);
  assert.equal(reads, 3);
  assert.equal(starts, 1);
});
test("model status polling stops when cancelled", async () => {
  const controller = new AbortController(); let reads = 0;
  await pollPromptProcessing(controller.signal, async () => { reads++; controller.abort(); return "idle"; }, () => { throw Error("unexpected prefill"); }, 1);
  assert.equal(reads, 1);
});
test("unsupported model status ends the fallback without affecting inference", async () => {
  let reads = 0;
  await pollPromptProcessing(new AbortController().signal, async () => { reads++; throw Error("unsupported"); }, () => { throw Error("unexpected prefill"); }, 1);
  assert.equal(reads, 1);
});
test("SDK auth uses only the selected connection token", () => {
  assert.deepEqual(sdkCredentials(undefined), {});
  assert.equal(sdkCredentials("Bearer arbitrary"), undefined);
  assert.deepEqual(sdkCredentials("Bearer sk-lm-abcdefgh:12345678901234567890"), { clientIdentifier: "abcdefgh", clientPasskey: "12345678901234567890" });
});
test("native history preserves roles, tool IDs, stored files and image parts", async () => {
  const sources: string[] = [];
  const history = await nativeHistory([
    { role: "system", content: "rules" },
    { role: "user", content: [{ type: "text", text: "look" }, { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } }, { type:"image_file", file_path:"C:/stored/screen.png", mime_type:"image/png" }] },
    { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "clock", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "c1", content: "noon" },
  ], async source => { sources.push(source.kind === "file" ? source.path : source.dataUrl); return { type: "file", identifier: "image1", name: "image.png", sizeBytes: 5, fileType: "image" }; });
  assert.equal(history[0].role, "system");
  assert.equal(history[1].content[1].type, "file");
  assert.equal(history[1].content[2].type, "file");
  assert.deepEqual(sources, ["data:image/png;base64,aGVsbG8=", "C:/stored/screen.png"]);
  assert.deepEqual(history[2].content[0], { type: "toolCallRequest", toolCallRequest: { id: "c1", type: "function", name: "clock", arguments: {} } });
  assert.deepEqual(history[3].content[0], { type: "toolCallResult", content: "noon", toolCallId: "c1" });
  const reasoningToolRound = await nativeHistory([
    { role: "assistant", content: "", reasoning_content: "hidden planning", tool_calls: [{ id: "c2", type: "function", function: { name: "clock", arguments: "{}" } }] },
  ], async () => { throw Error("no image expected"); });
  assert.deepEqual(reasoningToolRound[0].content[0], { type: "toolCallRequest", toolCallRequest: { id: "c2", type: "function", name: "clock", arguments: {} } });
  await assert.rejects(nativeHistory([{ role: "user", content: [{ type: "image_url", image_url: { url: "http://example.com/image" } }] }], async () => { throw Error("must not fetch"); }));
});
