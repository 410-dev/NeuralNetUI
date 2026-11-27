import assert from "node:assert/strict";
import test from "node:test";
import { applyContextState, isSummarized, keptTurnsStart, messageBeforeKeptTurns, messageBeforeLatestUser, normalizeContextState, withoutContentOverride, type ContextSourceMessage } from "./context-state.ts";
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


test("compaction keeps the last pairs word for word", () => {
  const turns = (n: number) => Array.from({ length: n }, (_, i) => [{ id: `u${i + 1}`, role: "user" }, { id: `a${i + 1}`, role: "assistant" }]).flat();
  const five = turns(5);
  // /compact after an answer: keep the last 3 pairs (u3..a5), fold u1..a2
  assert.equal(messageBeforeKeptTurns(five, 3, false), "a2");
  // at send time the newest request is pending on top of the pairs
  const sending = [...five, { id: "u6", role: "user" }];
  assert.equal(messageBeforeKeptTurns(sending, 3, true), "a2");
  assert.equal(keptTurnsStart(sending, 3, true), 4);
  // 0 pairs: fold everything before the request (the former behaviour)
  assert.equal(messageBeforeKeptTurns(sending, 0, true), "a5");
  assert.equal(messageBeforeKeptTurns(five, 0, false), "a5");
  // shorter than the setting: still fold the oldest turn
  assert.equal(messageBeforeKeptTurns(turns(2), 3, false), "a1");
  assert.equal(messageBeforeKeptTurns([...turns(1), { id: "u2", role: "user" }], 3, true), "a1");
  // nothing earlier to fold
  assert.equal(messageBeforeKeptTurns(turns(1), 3, false), undefined);
  // tool and assistant steps between users belong to their pair
  const withTools = [{ id: "u1", role: "user" }, { id: "a1", role: "assistant" }, { id: "t1", role: "tool" }, { id: "a1b", role: "assistant" }, { id: "u2", role: "user" }, { id: "a2", role: "assistant" }];
  assert.equal(messageBeforeKeptTurns(withTools, 1, false), "a1b");
});

test("traced tool records leave one line per agent change and nothing for lookups", async () => {
  const { applyContextState, toolTrace } = await import("./context-state.ts");
  const call = (name: string, args: unknown, result: unknown) => ({ id: name, name, status: "completed" as const, arguments: args, result }) as unknown as import("./types.ts").ToolEvent;
  const messages: import("./context-state.ts").ContextSourceMessage[] = [
    { id: "u1", role: "user", content: "watch the channel" },
    { id: "a1", role: "assistant", content: "Done.", toolEvents: [
      call("workboard_list", { kind: "memory" }, { memorys: [{ id: "m", body: "x".repeat(5000) }] }),
      call("notify_wakeup", { title: "러끼 채널", instructions: "…", every_minutes: 60 }, { id: "sch-1", intervalMinutes: 60 }),
      call("spawn_subagent", { title: "메일 확인", instructions: "…" }, { id: "run-9", status: "queued" }),
      call("workboard_add", { kind: "todo", title: "x" }, { error: "boom" }),
    ] },
    { id: "u2", role: "user", content: "next" },
    { id: "a2", role: "assistant", content: "Kept.", toolEvents: [call("workboard_list", {}, { todos: [] })] },
  ];
  const applied = applyContextState(messages, { overrides: {}, toolsTracedThroughMessageId: "a1" });
  const a1 = applied.entries.find(entry => entry.message.id === "a1")!;
  assert.equal(a1.message.toolEvents, undefined);
  assert.equal(a1.message.content, 'Done.\n\n[Scheduled] "러끼 채널" every 60 min (schedule id sch-1)\n\n[Delegated to a subagent] "메일 확인" (run id run-9)');
  assert.equal(applied.entries.find(entry => entry.message.id === "a2")!.message.toolEvents?.length, 1);
  assert.equal(toolTrace(call("update_wakeup", { id: "sch-1", enabled: false }, { id: "sch-1" })), "[Schedule changed] sch-1: enabled false");
  assert.equal(toolTrace(call("internet_search", { query: "x" }, { results: [] })), undefined);
});
