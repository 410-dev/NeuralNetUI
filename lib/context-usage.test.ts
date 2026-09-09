import assert from "node:assert/strict";
import test from "node:test";
import { contextUsage } from "./context-usage.ts";
import type { StoredMessage } from "./types.ts";

const messages: StoredMessage[] = [
  { id: "u", role: "user", content: "Hello", createdAt: "" },
  { id: "a", role: "assistant", content: "Answer", reasoning: "Think carefully", outputTokens: 100, reasoningTokens: 70, createdAt: "" },
];
test("context preview separates reasoning from output without double counting", () => {
  const off = contextUsage(messages, false);
  const on = contextUsage(messages, true);
  assert.equal(off.response, 30);
  assert.equal(off.reasoning, 0);
  assert.equal(on.reasoning, 70);
  assert.equal(on.total - off.total, 70);
  assert.equal(on.total, on.input + on.response + on.reasoning);
});
test("drafts, attachments and streamed reasoning update the preview", () => {
  assert.ok(contextUsage(messages, false, "new prompt").input > contextUsage(messages, false).input);
  assert.ok(contextUsage([{ ...messages[0], attachments: [{ id: "image" } as never] }], false).input > contextUsage([messages[0]], false).input);
  const stream = { ...messages[1], outputTokens: undefined, reasoningTokens: undefined };
  assert.ok(contextUsage([stream], true).reasoning > 0);
  assert.equal(contextUsage([], false).total, 0);
});
test("invalid or oversized reasoning counters cannot make response negative", () => {
  const usage = contextUsage([{ ...messages[1], reasoningTokens: 200 }], true);
  assert.equal(usage.response, 0);
  assert.equal(usage.reasoning, 100);
});
