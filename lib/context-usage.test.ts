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
  assert.equal(on.total, on.input + on.response + on.reasoning + on.tools + on.summary);
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

test("a compaction summary replaces the history it covers", () => {
  const long = "x".repeat(4000);
  const history: StoredMessage[] = [
    { id: "u1", role: "user", content: long, createdAt: "" },
    { id: "a1", role: "assistant", content: long, outputTokens: 900, createdAt: "" },
    { id: "u2", role: "user", content: "carry on", createdAt: "" },
    { id: "a2", role: "assistant", content: "continuing", outputTokens: 40, createdAt: "" },
  ];
  const before = contextUsage(history, false);
  const compacted = contextUsage(history.map((message) => message.id === "a2"
    ? { ...message, steps: [{ kind: "compaction" as const, summary: "short summary of everything earlier" }, { kind: "content" as const, text: "continuing" }] }
    : message), false);
  assert.ok(compacted.total < before.total / 2, `compaction should cut the preview: ${compacted.total} vs ${before.total}`);
  assert.ok(compacted.summary > 0, "the summary is counted");
  assert.equal(compacted.total, compacted.input + compacted.response + compacted.reasoning + compacted.tools + compacted.summary);
  // Only the compacting turn survives, so the long first exchange is gone from the preview.
  assert.ok(compacted.input < 200, `covered history is excluded: ${compacted.input}`);
});

test("only the most recent compaction sets the boundary", () => {
  const step = (summary: string) => [{ kind: "compaction" as const, summary }];
  const history: StoredMessage[] = [
    { id: "u1", role: "user", content: "one", createdAt: "" },
    { id: "a1", role: "assistant", content: "first", outputTokens: 10, steps: step("earlier summary"), createdAt: "" },
    { id: "u2", role: "user", content: "two", createdAt: "" },
    { id: "a2", role: "assistant", content: "second", outputTokens: 10, steps: step("the later summary text"), createdAt: "" },
  ];
  const usage = contextUsage(history, false);
  assert.equal(usage.summary, contextUsage([history[3]], false, "", "").summary);
  // A compaction step without a summary must not move the boundary.
  const noSummary: StoredMessage[] = [history[0], { ...history[1], steps: [{ kind: "compaction" }] }, history[2]];
  assert.equal(contextUsage(noSummary, false).summary, 0);
});

test("tool calls and results have a visible context category", () => {
  const usage = contextUsage([
    { id: "u", role: "user", content: "look it up", createdAt: "" },
    { id: "a", role: "assistant", content: "", toolEvents: [{ id: "tool-1", name: "visit_page", status: "completed", arguments: { url: "https://example.com" }, result: { text: "result ".repeat(200) }, startedAt: "" }], createdAt: "" },
  ], false);
  assert.ok(usage.tools > 100);
  assert.equal(usage.total, usage.input + usage.response + usage.reasoning + usage.tools + usage.summary);
});

test("an in-progress compaction immediately replaces covered content and tool output", () => {
  const beforeText = "covered response ".repeat(400);
  const afterText = "new response";
  const message: StoredMessage = {
    id: "a", role: "assistant", content: beforeText + afterText, reasoning: "covered reasoning", outputTokens: 1800, reasoningTokens: 600, createdAt: "",
    toolEvents: [
      { id: "old-tool", name: "visit_page", status: "completed", result: { text: "covered tool output ".repeat(200) }, startedAt: "" },
      { id: "new-tool", name: "get_current_time", status: "completed", result: { time: "12:00" }, startedAt: "" },
    ],
    steps: [
      { kind: "content", text: beforeText },
      { kind: "tools", ids: ["old-tool"] },
      { kind: "compaction", summary: "live partial summary" },
      { kind: "content", text: afterText },
      { kind: "tools", ids: ["new-tool"] },
    ],
  };
  const uncompacted = contextUsage([{ ...message, steps: undefined }], false);
  const compacted = contextUsage([message], false);
  assert.ok(compacted.response < uncompacted.response / 10);
  assert.ok(compacted.tools < uncompacted.tools / 10);
  assert.ok(compacted.summary > 0);
});
