import assert from "node:assert/strict";
import test from "node:test";
import { multipleChoiceAnswers, pendingMultipleChoiceEvent, removeUserMessagePair } from "./conversation-messages.ts";
import type { StoredMessage, ToolEvent } from "./types.ts";

const message = (id: string, role: StoredMessage["role"]): StoredMessage => ({ id, role, content: id, createdAt: "2026-08-30T00:00:00.000Z" });

test("removeUserMessagePair removes a user request and its immediately connected assistant response", () => {
  const messages = [message("u1", "user"), message("a1", "assistant"), message("u2", "user"), message("a2", "assistant")];
  assert.deepEqual(removeUserMessagePair(messages, "u1").map(({ id }) => id), ["u2", "a2"]);
});

test("removeUserMessagePair leaves unrelated messages and handles a request without a response", () => {
  const messages = [message("a0", "assistant"), message("u1", "user")];
  assert.deepEqual(removeUserMessagePair(messages, "missing"), messages);
  assert.deepEqual(removeUserMessagePair(messages, "u1").map(({ id }) => id), ["a0"]);
});

test("pendingMultipleChoiceEvent returns the newest waiting question", () => {
  const first: ToolEvent = { id: "choice-1", name: "ask_multiple_choice", status: "waiting", startedAt: "2026-08-30T00:00:00.000Z" };
  const second: ToolEvent = { ...first, id: "choice-2" };
  const messages = [{ ...message("a1", "assistant"), toolEvents: [first] }, { ...message("a2", "assistant"), toolEvents: [second] }];
  assert.equal(pendingMultipleChoiceEvent(messages)?.id, "choice-2");
});

test("multipleChoiceAnswers normalizes persisted tool results for display", () => {
  const event: ToolEvent = {
    id: "choice-1", name: "ask_multiple_choice", status: "completed", startedAt: "2026-08-30T00:00:00.000Z",
    result: { answers: [{ question: "Dinner?", type: "multi_select", selections: ["Korean", "Italian"], other: "  light meal  " }] },
  };
  assert.deepEqual(multipleChoiceAnswers(event), [{ question: "Dinner?", type: "multi_select", selections: ["Korean", "Italian"], other: "light meal" }]);
});
