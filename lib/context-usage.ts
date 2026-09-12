import { estimateTokens } from "./harness.ts";
import type { StoredMessage } from "./types.ts";

export type ContextUsage = { input: number; response: number; reasoning: number; tools: number; summary: number; total: number };
const count = (value: number | undefined) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
const estimate = (text: string | undefined) => text ? estimateTokens(text) : 0;

/**
 * Where the next request actually starts. Compaction replaces everything before the compacting
 * turn with a summary, so the preview must begin at that turn and count the summary instead of
 * the history it stands in for.
 */
function compactionBoundary(messages: StoredMessage[]): { start: number; summary: number; message: number; step: number } {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const steps = messages[index].steps || [];
    const stepIndex = steps.findLastIndex(step => step.kind === "compaction" && Boolean(step.summary));
    const compaction = steps[stepIndex];
    if (!compaction || compaction.kind !== "compaction" || !compaction.summary) continue;
    let start = index;
    while (start > 0 && messages[start].role !== "user") start -= 1;
    return { start, summary: estimate(compaction.summary), message: index, step: stepIndex };
  }
  return { start: 0, summary: 0, message: -1, step: -1 };
}

/** Next-request history preview, not the previous request's immutable usage receipt.
 * Output counters include reasoning; upstream input counters already include history and must
 * never be summed across turns. Attachments/formatting and untokenized text are estimates.
 */
export function contextUsage(messages: StoredMessage[], includeReasoning: boolean, draft = "", systemPrompt = "", draftAttachments = 0): ContextUsage {
  const boundary = compactionBoundary(messages);
  const { start, summary } = boundary;
  let input = estimate(systemPrompt) + estimate(draft) + draftAttachments * 1600;
  let response = 0; let reasoning = 0; let tools = 0;
  for (const [offset, message] of messages.slice(start).entries()) {
    if (message.role === "user") input += estimate(message.content) + (message.attachments?.length || 0) * 1600;
    else {
      const messageIndex = start + offset;
      const afterCompaction = messageIndex === boundary.message ? (message.steps || []).slice(boundary.step + 1) : undefined;
      const contentText = afterCompaction ? afterCompaction.filter(step => step.kind === "content").map(step => step.text).join("") : message.content;
      const reasoningText = afterCompaction ? afterCompaction.filter(step => step.kind === "reasoning").map(step => step.text).join("") : message.reasoning;
      // Persisted usage counters cover the whole assistant message. Once a compaction sits inside
      // that message, only its trailing steps survive in context, so whole-message counters would
      // reintroduce the content that the summary replaced.
      const output = afterCompaction ? undefined : count(message.outputTokens);
      const thinking = Math.min(output ?? Infinity, afterCompaction ? estimate(reasoningText) : count(message.reasoningTokens) ?? estimate(reasoningText));
      response += output === undefined ? estimate(contentText) : Math.max(0, output - thinking);
      if (includeReasoning) reasoning += thinking;
      const trailingToolIds = afterCompaction ? new Set(afterCompaction.filter(step => step.kind === "tools").flatMap(step => step.ids)) : undefined;
      // Tool calls/results and their protocol fields remain in the next request's input context.
      for (const event of message.toolEvents || []) if (!trailingToolIds || trailingToolIds.has(event.id)) tools += estimateTokens({ name: event.name, arguments: event.arguments, result: event.result });
    }
  }
  return { input, response, reasoning, tools, summary, total: input + response + reasoning + tools + summary };
}
