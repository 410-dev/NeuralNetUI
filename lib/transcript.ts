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
