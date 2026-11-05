import assert from "node:assert/strict";
import test from "node:test";
import { displaySteps, lastContentStep, reasoningStepIsWhole, replaceAssistantContent, stepToolEvents, transcriptSteps } from "./transcript.ts";
import type { MessageStep, StoredMessage, ToolEvent } from "./types.ts";

const event = (id: string): ToolEvent => ({ id, name: "internet_search", status: "completed", startedAt: "now" });
const message = (extra: Partial<StoredMessage>): StoredMessage => ({ id: "a", role: "assistant", content: "", createdAt: "now", ...extra });

test("a message without steps keeps the old reasoning, tools, answer order", () => {
  const legacy = message({ reasoning: "thought", reasoningDurationSeconds: 4, toolEvents: [event("t1"), event("t2")], content: "answer" });
  assert.deepEqual(transcriptSteps(legacy), [
    { kind: "reasoning", text: "thought", seconds: 4 },
    { kind: "tools", ids: ["t1", "t2"] },
    { kind: "content", text: "answer" },
  ]);
  assert.deepEqual(transcriptSteps(message({ content: "just text" })), [{ kind: "content", text: "just text" }]);
  assert.deepEqual(transcriptSteps(message({})), []);
  assert.equal(reasoningStepIsWhole(legacy), true);
});

test("recorded steps are preserved in order, including text after a tool round", () => {
  const steps: MessageStep[] = [
    { kind: "reasoning", text: "plan", seconds: 83 },
    { kind: "content", text: "first" },
    { kind: "tools", ids: ["t1"] },
    { kind: "content", text: "second" },
    { kind: "compaction", seconds: 100, summary: "short" },
    { kind: "content", text: "third" },
  ];
  const recorded = message({ steps, reasoning: "plan", content: "firstsecondthird", toolEvents: [event("t1")] });
  assert.deepEqual(transcriptSteps(recorded).map((step) => step.kind), ["reasoning", "content", "tools", "content", "compaction", "content"]);
  assert.equal(lastContentStep(transcriptSteps(recorded)), 5);
  assert.equal(reasoningStepIsWhole(recorded), false);
});

test("empty steps are dropped so a stalled turn shows nothing", () => {
  const steps: MessageStep[] = [{ kind: "reasoning", text: "" }, { kind: "tools", ids: [] }, { kind: "content", text: "" }, { kind: "compaction", seconds: 2 }];
  assert.deepEqual(transcriptSteps(message({ steps })), [{ kind: "compaction", seconds: 2 }]);
  // Dropping every step must not resurrect the legacy layout from an empty message.
  assert.deepEqual(transcriptSteps(message({ steps: [{ kind: "content", text: "" }] })), []);
  assert.equal(lastContentStep([]), -1);
});

test("a tool round resolves only its own events, in the order requested", () => {
  const events = [event("t2"), event("t1"), event("t3")];
  assert.deepEqual(stepToolEvents(["t1", "t3"], events).map((item) => item.id), ["t1", "t3"]);
  // An id with no stored event is skipped rather than rendering a placeholder.
  assert.deepEqual(stepToolEvents(["t1", "missing"], events).map((item) => item.id), ["t1"]);
  assert.deepEqual(stepToolEvents(["t1"], undefined), []);
});

test("editing an assistant answer replaces stale content steps and keeps technical activity", () => {
  const original = message({
    content: "old beforeold after",
    reasoning: "plan",
    toolEvents: [event("t1")],
    steps: [
      { kind: "reasoning", text: "plan" },
      { kind: "content", text: "old before" },
      { kind: "tools", ids: ["t1"] },
      { kind: "content", text: "old after" },
    ],
  });
  const edited = replaceAssistantContent(original, "  corrected answer  ");
  assert.equal(edited.content, "corrected answer");
  assert.deepEqual(edited.steps, [
    { kind: "reasoning", text: "plan" },
    { kind: "tools", ids: ["t1"] },
    { kind: "content", text: "corrected answer" },
  ]);
  assert.deepEqual(transcriptSteps(edited).filter((step) => step.kind === "content"), [{ kind: "content", text: "corrected answer" }]);
});

test("editing a recorded assistant answer adds content when the transcript had activity only", () => {
  const edited = replaceAssistantContent(message({ content: "", steps: [{ kind: "tools", ids: ["t1"] }] }), "new answer");
  assert.deepEqual(edited.steps, [{ kind: "tools", ids: ["t1"] }, { kind: "content", text: "new answer" }]);
});

test("reasoning and tool rounds merge until readable text starts a new section", () => {
  const steps: MessageStep[] = [
    { kind: "reasoning", text: "plan ", seconds: 8 },
    { kind: "tools", ids: ["t1"] },
    { kind: "reasoning", text: " check", seconds: 6 },
    { kind: "tools", ids: ["t2"] },
    { kind: "content", text: "\n" },
    { kind: "tools", ids: ["t3"] },
    { kind: "reasoning", text: "done", seconds: 10 },
    { kind: "content", text: "answer" },
    { kind: "tools", ids: ["t4"] },
    { kind: "tools", ids: ["t5"] },
  ];
  const shown = displaySteps(steps, (ids) => `[${ids.join(",")}]`);
  assert.deepEqual(shown, [
    // Whitespace-only text is not something to read, so it does not split the section.
    { kind: "reasoning", text: "plan\n\n[t1]\n\ncheck\n\n[t2,t3]\n\ndone", seconds: 24, live: false },
    { kind: "tools", ids: ["t1", "t2", "t3"] },
    { kind: "content", text: "answer" },
    { kind: "tools", ids: ["t4", "t5"], live: true },
  ]);
});

test("the merged reasoning block stays live while its latest pass streams", () => {
  const shown = displaySteps([
    { kind: "reasoning", text: "a", seconds: 3 },
    { kind: "tools", ids: ["t1"] },
    { kind: "reasoning", text: "b" },
  ]);
  assert.equal(shown.length, 2);
  assert.equal(shown[0].kind, "reasoning");
  assert.equal(shown[0].live, true);
  assert.equal(shown[0].kind === "reasoning" && shown[0].text, "a\n\nb");
});
