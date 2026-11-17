import assert from "node:assert/strict";
import test from "node:test";
import { applyContextState, isSummarized, messageBeforeLatestUser, normalizeContextState, withoutContentOverride, type ContextSourceMessage } from "./context-state.ts";
import { contextUsage } from "./context-usage.ts";

const tool = (id: string) => ({ id, name: "internet_search", status: "completed" as const, arguments: { query: id }, result: { hits: [id] }, startedAt: "2026-11-17T00:00:00Z" });
const history: ContextSourceMessage[] = [
  { id: "u1", role: "user", content: "first" },
  { id: "a1", role: "assistant", content: "answer one", reasoning: "thinking one", toolEvents: [tool("t1")] },
  { id: "u2", role: "user", content: "second" },
  { id: "a2", role: "assistant", content: "", toolEvents: [tool("t2")] },
  { id: "a3", role: "assistant", content: "answer two", reasoning: "thinking two" },
  { id: "u3", role: "user", content: "third" },
];

test("a summary replaces everything up to its message, and dropped details stop at theirs", () => {
  const applied = applyContextState(history, normalizeContextState({ summary: { text: "S", throughMessageId: "a1" }, droppedThroughMessageId: "a2", overrides: {} }));
  assert.equal(applied.summary, "S");
  assert.deepEqual(applied.summarized.map(message => message.id), ["u1", "a1"]);
  // a2 had only a tool call: once its details are dropped nothing is left to send.
  assert.deepEqual(applied.entries.map(entry => entry.message.id), ["u2", "a3", "u3"]);
  assert.equal(applied.entries[1].message.reasoning, "thinking two", "details after the drop point stay");
});

test("context-view edits change only the model input, and ids missing from a branch are ignored", () => {
  const state = normalizeContextState({
    summary: { text: "S", throughMessageId: "not-in-this-branch" },
    overrides: {
      a1: { content: "edited answer", removeReasoning: true, tools: { t1: { result: { hits: ["edited"] } } } },
      u2: { removed: true },
      ghost: { content: "never applied" },
    },
  });
  const applied = applyContextState(history, state);
  assert.equal(applied.summary, undefined);
  const a1 = applied.entries.find(entry => entry.original.id === "a1")!;
  assert.equal(a1.message.content, "edited answer"); assert.equal(a1.message.reasoning, undefined); assert.deepEqual(a1.message.toolEvents?.[0].result, { hits: ["edited"] });
  assert.equal(a1.original.content, "answer one");
  assert.equal(a1.overridden, true);
  assert.equal(applied.entries.some(entry => entry.original.id === "u2"), false);
  assert.equal(history[1].content, "answer one", "the transcript is untouched");
});

test("state helpers: summarized region, clearing an edit, and the send-time cut point", () => {
  const state = normalizeContextState({ summary: { text: "S", throughMessageId: "u2" }, overrides: { a1: { content: "x", removeReasoning: true } } });
  assert.equal(isSummarized(history, state, "a1"), true);
  assert.equal(isSummarized(history, state, "a3"), false);
  assert.deepEqual(withoutContentOverride(state, "a1").overrides, { a1: { removeReasoning: true } });
  assert.equal(messageBeforeLatestUser(history), "a3");
  assert.equal(messageBeforeLatestUser([{ id: "only", role: "user" }]), undefined);
});

test("malformed state is cleaned up", () => {
  assert.deepEqual(normalizeContextState({ summary: { text: "  ", throughMessageId: "a1" }, droppedThroughMessageId: "bad id!", overrides: { "a1": "nope", "u1": { content: 4, removed: true } } }), { overrides: { u1: { removed: true } } });
});

test("context usage follows the stored state", () => {
  const stored = history.map(message => ({ ...message, createdAt: "2026-11-17T00:00:00Z" })) as never;
  const full = contextUsage(stored, true);
  const compacted = contextUsage(stored, true, "", "", 0, normalizeContextState({ summary: { text: "short", throughMessageId: "a3" }, overrides: {} }));
  assert.ok(compacted.total < full.total);
  assert.ok(compacted.summary > 0);
  assert.equal(compacted.tools, 0);
});
