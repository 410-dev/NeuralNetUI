import type { MultipleChoiceQuestion, StoredMessage, ToolEvent } from "./types";

export type MultipleChoiceAnswer = {
  question: string;
  type: MultipleChoiceQuestion["type"];
  selections: string[];
  other?: string;
};

export function removeUserMessagePair(messages: StoredMessage[], messageId: string): StoredMessage[] {
  const index = messages.findIndex((message) => message.id === messageId && message.role === "user");
  if (index < 0) return messages;
  const removeAssistant = messages[index + 1]?.role === "assistant";
  return [...messages.slice(0, index), ...messages.slice(index + (removeAssistant ? 2 : 1))];
}

export function pendingMultipleChoiceEvent(messages: StoredMessage[]): ToolEvent | undefined {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const events = messages[messageIndex].toolEvents || [];
    for (let eventIndex = events.length - 1; eventIndex >= 0; eventIndex -= 1) {
      const event = events[eventIndex];
      if (event.name === "ask_multiple_choice" && event.status === "waiting") return event;
    }
  }
  return undefined;
}

export function multipleChoiceAnswers(event: ToolEvent): MultipleChoiceAnswer[] {
  if (event.name !== "ask_multiple_choice" || !event.result || typeof event.result !== "object") return [];
  const rawAnswers = (event.result as { answers?: unknown }).answers;
  if (!Array.isArray(rawAnswers)) return [];
  return rawAnswers.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const answer = value as Record<string, unknown>;
    const type = ["single_select", "multi_select", "rank_priorities"].includes(String(answer.type))
      ? String(answer.type) as MultipleChoiceQuestion["type"]
      : "single_select";
    return [{
      question: String(answer.question || ""),
      type,
      selections: Array.isArray(answer.selections) ? answer.selections.map(String).filter(Boolean) : [],
      ...(String(answer.other || "").trim() ? { other: String(answer.other).trim() } : {}),
    }];
  });
}

export function settlePendingTools(messages: StoredMessage[]): StoredMessage[] {
  return messages.map(message => ({ ...message, toolEvents: message.toolEvents?.map(event =>
    event.status === "waiting" || event.status === "calling"
      ? { ...event, status: "error", completedAt: new Date().toISOString(), result: { error: "The previous task was interrupted. Please retry." } }
      : event) }));
}

/** Reconstruct complete call/result pairs. Pending calls are never sent upstream. */
export function restoreToolHistory(message: { role: string; content: unknown; toolEvents?: ToolEvent[]; reasoning_content?: string }) {
  const events = message.role === "assistant" ? (message.toolEvents || []).filter(e => e.status === "completed" || e.status === "error") : [];
  const result: Array<{ role: string; content: unknown; reasoning_content?: string; tool_calls?: unknown; tool_call_id?: string; name?: string }> = [];
  if (events.length) {
    result.push({ role: "assistant", content: null, tool_calls: events.map(e => ({ id: e.id, type: "function", function: { name: e.name, arguments: JSON.stringify(e.arguments ?? {}) } })) });
    for (const event of events) result.push({ role: "tool", tool_call_id: event.id, name: event.name, content: JSON.stringify(event.result ?? { error: "No tool result was saved." }) });
  }
  if (message.content || !events.length) result.push({ role: message.role, content: message.content, ...(message.reasoning_content ? { reasoning_content: message.reasoning_content } : {}) });
  return result;
}
