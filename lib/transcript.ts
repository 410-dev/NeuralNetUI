import type { MessageStep, StoredMessage, ToolEvent } from "./types.ts";

/**
 * The stages of an assistant turn in the order they happened. Messages written before the
 * sequential transcript existed carry no steps, so their fixed layout — reasoning, then tools,
 * then the answer — is reconstructed instead.
 */
export function transcriptSteps(message: StoredMessage): MessageStep[] {
  const kept = (message.steps || []).filter((step) =>
    step.kind === "tools" ? step.ids.length
      : step.kind === "compaction" ? true
      : Boolean(step.text));
  if (kept.length) return kept;
  const legacy: MessageStep[] = [];
  if (message.reasoning) legacy.push({ kind: "reasoning", text: message.reasoning, seconds: message.reasoningDurationSeconds });
  if (message.toolEvents?.length) legacy.push({ kind: "tools", ids: message.toolEvents.map((event) => event.id) });
  if (message.content) legacy.push({ kind: "content", text: message.content });
  return legacy;
}

export type DisplayStep = MessageStep & {
  /** True when the step that is still being written was merged into this one. */
  live?: boolean;
};

/**
 * Folds the recorded stages into what the transcript shows. Only text the reader is meant to
 * read starts a new section: until it appears, every reasoning stage joins one reasoning block
 * and every tool round joins one tool group, each placed where its kind first appeared. Tool
 * rounds that happened between two reasoning stages become markers inside the merged reasoning,
 * produced by `toolMarker` when given.
 */
export function displaySteps(steps: MessageStep[], toolMarker?: (ids: string[]) => string): DisplayStep[] {
  const shown: DisplayStep[] = [];
  let reasoning: Extract<DisplayStep, { kind: "reasoning" }> | undefined;
  let tools: Extract<DisplayStep, { kind: "tools" }> | undefined;
  let pendingToolIds: string[] = [];
  steps.forEach((step, index) => {
    const last = index === steps.length - 1;
    if (step.kind === "content") {
      if (!step.text.trim()) return;
      reasoning = undefined; tools = undefined; pendingToolIds = [];
      shown.push({ ...step, ...(last ? { live: true } : {}) });
      return;
    }
    if (step.kind === "reasoning") {
      if (!reasoning) {
        reasoning = { ...step };
        shown.push(reasoning);
      } else {
        const marker = pendingToolIds.length && toolMarker ? toolMarker(pendingToolIds) : "";
        const joined = [reasoning.text.replace(/\s+$/, ""), marker, step.text.replace(/^\s+/, "")].filter(Boolean).join("\n\n");
        reasoning.text = joined;
        if (reasoning.seconds !== undefined || step.seconds !== undefined) reasoning.seconds = (reasoning.seconds ?? 0) + (step.seconds ?? 0);
      }
      pendingToolIds = [];
      reasoning.live = last && step.seconds === undefined;
      return;
    }
    if (step.kind === "tools") {
      if (!tools) {
        tools = { ...step, ids: [...step.ids] };
        shown.push(tools);
      } else tools.ids.push(...step.ids);
      if (reasoning) pendingToolIds.push(...step.ids);
      if (last) tools.live = true;
      return;
    }
    shown.push({ ...step, ...(last ? { live: true } : {}) });
  });
  return shown;
}

/** Index of the step still being written, so only that one animates while a response streams. */
export function lastContentStep(steps: MessageStep[]): number {
  for (let index = steps.length - 1; index >= 0; index -= 1) if (steps[index].kind === "content") return index;
  return -1;
}

/** Tool events belonging to one round, in the order the model asked for them. */
export function stepToolEvents(ids: string[], events: ToolEvent[] = []): ToolEvent[] {
  const byId = new Map(events.map((event) => [event.id, event]));
  return ids.map((id) => byId.get(id)).filter((event): event is ToolEvent => Boolean(event));
}

/**
 * Reasoning a step should display. Legacy messages keep one reasoning block holding the whole
 * transcript, so the tool markers stay useful there; a per-step block already sits in sequence.
 */
export function reasoningStepIsWhole(message: StoredMessage): boolean {
  return !(message.steps || []).some((step) => step.kind === "reasoning");
}

/**
 * Replaces the user-visible answer without leaving stale per-stage content behind. Assistant
 * edits represent one complete replacement, while reasoning, tool and compaction records remain
 * useful audit context. Keep those records in order and put the replacement where the final
 * delivered-content stage lived (or at the end when the original had no content stage).
 */
export function replaceAssistantContent(message: StoredMessage, content: string): StoredMessage {
  const trimmed = content.trim();
  const steps = message.steps;
  if (!steps?.length) return { ...message, content: trimmed };
  const finalContentIndex = lastContentStep(steps);
  const retained = steps.filter((step) => step.kind !== "content");
  const insertionIndex = finalContentIndex < 0
    ? retained.length
    : steps.slice(0, finalContentIndex).filter((step) => step.kind !== "content").length;
  return {
    ...message,
    content: trimmed,
    steps: [...retained.slice(0, insertionIndex), { kind: "content", text: trimmed }, ...retained.slice(insertionIndex)],
  };
}
