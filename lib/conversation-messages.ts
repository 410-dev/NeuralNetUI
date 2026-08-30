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
