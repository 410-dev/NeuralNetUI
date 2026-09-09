import { estimateTokens } from "./harness.ts";
import type { StoredMessage } from "./types.ts";

export type ContextUsage = { input: number; response: number; reasoning: number; summary: number; total: number };
const count = (value: number | undefined) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
const estimate = (text: string | undefined) => text ? estimateTokens(text) : 0;

/**
 * Where the next request actually starts. Compaction replaces everything before the compacting
 * turn with a summary, so the preview must begin at that turn and count the summary instead of
 * the history it stands in for.
 */
function compactionBoundary(messages: StoredMessage[]): { start: number; summary: number } {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const compaction = messages[index].steps?.filter((step) => step.kind === "compaction" && step.summary).at(-1);
    if (!compaction || compaction.kind !== "compaction" || !compaction.summary) continue;
    let start = index;
    while (start > 0 && messages[start].role !== "user") start -= 1;
    return { start, summary: estimate(compaction.summary) };
  }
  return { start: 0, summary: 0 };
}

/** Next-request history preview, not the previous request's immutable usage receipt.
 * Output counters include reasoning; upstream input counters already include history and must
 * never be summed across turns. Attachments/formatting and untokenized text are estimates.
 */
export function contextUsage(messages: StoredMessage[], includeReasoning: boolean, draft = "", systemPrompt = "", draftAttachments = 0): ContextUsage {
  const { start, summary } = compactionBoundary(messages);
  let input = estimate(systemPrompt) + estimate(draft) + draftAttachments * 1600;
  let response = 0; let reasoning = 0;
  for (const message of messages.slice(start)) {
    if (message.role === "user") input += estimate(message.content) + (message.attachments?.length || 0) * 1600;
    else {
      const output = count(message.outputTokens);
      const thinking = Math.min(output ?? Infinity, count(message.reasoningTokens) ?? estimate(message.reasoning));
      response += output === undefined ? estimate(message.content) : Math.max(0, output - thinking);
      if (includeReasoning) reasoning += thinking;
      // Tool definitions/results and protocol formatting belong to input context.
      for (const event of message.toolEvents || []) input += estimateTokens({ name: event.name, arguments: event.arguments, result: event.result });
    }
  }
  return { input, response, reasoning, summary, total: input + response + reasoning + summary };
}
