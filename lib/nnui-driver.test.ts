import assert from "node:assert/strict";
import test from "node:test";
import { nnuiEventFromSse, nnuiEventProgress } from "./nnui-driver.ts";

test("NNUI SSE events expose bounded load and prefill progress", () => {
  const load = nnuiEventFromSse('id: 1\nevent: model.load.progress\ndata: {"type":"model.load.progress","model":"local","session_id":null,"data":{"percent":42}}');
  assert.equal(load?.model, "local");
  assert.deepEqual(nnuiEventProgress(load!), { phase: "loading-model", progress: 0.42 });

  const prefill = nnuiEventFromSse('event: request.prefill.progress\ndata: {"type":"request.prefill.progress","model":"local","session_id":"chat-1","data":{"prompt_progress":0.75}}');
  assert.equal(prefill?.session_id, "chat-1");
  assert.deepEqual(nnuiEventProgress(prefill!), { phase: "processing-prompt", progress: 0.75 });
  assert.equal(nnuiEventFromSse("event: connected\ndata: {}"), undefined);
  assert.equal(nnuiEventFromSse("event: bad\ndata: not-json"), undefined);
});
