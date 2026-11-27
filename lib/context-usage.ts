import { estimateTokens } from "./harness.ts";
import type { StoredMessage } from "./types.ts";
import { applyContextState, type ContextState } from "./context-state.ts";

export type ContextUsage = { input: number; response: number; reasoning: number; tools: number; summary: number; definitions: number; total: number };
const count = (value: number | undefined) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
const estimate = (text: string | undefined) => text ? estimateTokens(text) : 0;

/**
 * The tool definitions every request carries, as the newest reply's last request sent them. The next request offers
 * the same tools unless the person changes them; before any reply there is nothing to go by.
 */
function toolDefinitions(messages: StoredMessage[]) {
  return count(messages.findLast(message => message.role === "assistant" && message.toolDefinitionTokens !== undefined)?.toolDefinitionTokens) ?? 0;
}

/**
 * Where the next request actually starts. Compaction replaces everything before the compacting
 * turn with a summary, so the preview must begin at that turn and count the summary instead of
 * the history it stands in for.
 */
function compactionBoundary(messages: StoredMessage[]): { start: number; summary: number; message: number; step: number; retainedToolIds: string[] } {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const steps = messages[index].steps || [];
    const stepIndex = steps.findLastIndex(step => step.kind === "compaction" && Boolean(step.summary));
    const compaction = steps[stepIndex];
    if (!compaction || compaction.kind !== "compaction" || !compaction.summary) continue;
    let start = index;
    while (start > 0 && messages[start].role !== "user") start -= 1;
    return { start, summary: estimate(compaction.summary), message: index, step: stepIndex, retainedToolIds: compaction.retainedToolIds || [] };
  }
  return { start: 0, summary: 0, message: -1, step: -1, retainedToolIds: [] };
}

/** Next-request history preview, not the previous request's immutable usage receipt.
 * Output counters include reasoning; upstream input counters already include history and must
 * never be summed across turns. Attachments/formatting and untokenized text are estimates.
 */
export function contextUsage(messages: StoredMessage[], includeReasoning: boolean, draft = "", systemPrompt = "", draftAttachments = 0, state?: ContextState, overhead?: RequestOverhead): ContextUsage {
  const usage = state ? stateUsage(messages, includeReasoning, draft, systemPrompt, draftAttachments, state) : historyUsage(messages, includeReasoning, draft, systemPrompt, draftAttachments);
  if (!overhead) return usage;
  // The server's estimate for the tools switched on now wins over what the last reply carried.
  const definitions = overhead.definitions ?? usage.definitions;
  const input = usage.input + (overhead.system || 0);
  return { ...usage, input, definitions, total: input + usage.response + usage.reasoning + usage.tools + usage.summary + definitions };
}

/** Sent with every request besides the conversation, as the server estimates it (see /api/chat/overhead). */
export type RequestOverhead = { definitions?: number; system?: number };

function historyUsage(messages: StoredMessage[], includeReasoning: boolean, draft: string, systemPrompt: string, draftAttachments: number): ContextUsage {
  const boundary = compactionBoundary(messages);
  const { start, summary } = boundary;
  let input = estimate(systemPrompt) + estimate(draft) + draftAttachments * 1600;
  let response = 0; let reasoning = 0; let tools = 0;
  for (const [offset, message] of messages.slice(start).entries()) {
    if (message.role === "user") input += estimate(message.content) + estimate(message.contextPrefix) + (message.attachments?.length || 0) * 1600;
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
      const trailingToolIds = afterCompaction ? new Set([...boundary.retainedToolIds, ...afterCompaction.filter(step => step.kind === "tools").flatMap(step => step.ids)]) : undefined;
      // Tool calls/results and their protocol fields remain in the next request's input context.
      for (const event of message.toolEvents || []) if (!trailingToolIds || trailingToolIds.has(event.id)) {
        const base = estimateTokens({ name: event.name, arguments: event.arguments, result: event.result });
        const result = event.result && typeof event.result === "object" ? event.result as Record<string, unknown> : undefined;
        const visual = result?.contextTokensConsumed !== true && Number.isFinite(Number(result?.contextTokens)) ? Math.max(0, Number(result?.contextTokens)) : 0;
        tools += Math.max(base, visual);
      }
    }
  }
  const definitions = toolDefinitions(messages);
  return { input, response, reasoning, tools, summary, definitions, total: input + response + reasoning + tools + summary + definitions };
}

/**
 * Usage when the branch's context state is known: the stored summary replaces what it covers, dropped details and
 * context-view edits are applied, and the model sees each remaining message as the state shapes it.
 */
function stateUsage(messages: StoredMessage[], includeReasoning: boolean, draft: string, systemPrompt: string, draftAttachments: number, state: ContextState): ContextUsage {
  const applied = applyContextState(messages, state);
  const summary = estimate(applied.summary);
  let input = estimate(systemPrompt) + estimate(draft) + draftAttachments * 1600;
  let response = 0; let reasoning = 0; let tools = 0;
  for (const { message, original, overridden, detailsDropped } of applied.entries) {
    if (message.role === "user") { input += estimate(message.content) + estimate(message.contextPrefix) + (message.attachments?.length || 0) * 1600; continue; }
    // Stored counters describe the original reply; once its text or details changed, estimate what is sent instead.
    const counted = !overridden && !detailsDropped ? count(original.outputTokens) : undefined;
    const thinking = message.reasoning ? Math.min(counted ?? Infinity, !overridden && !detailsDropped ? count(original.reasoningTokens) ?? estimate(message.reasoning) : estimate(message.reasoning)) : 0;
    response += counted === undefined ? estimate(message.content) : Math.max(0, counted - thinking);
    if (includeReasoning) reasoning += thinking;
    for (const event of message.toolEvents || []) {
      const base = estimateTokens({ name: event.name, arguments: event.arguments, result: event.result });
      const result = event.result && typeof event.result === "object" ? event.result as Record<string, unknown> : undefined;
      const visual = result?.contextTokensConsumed !== true && Number.isFinite(Number(result?.contextTokens)) ? Math.max(0, Number(result?.contextTokens)) : 0;
      tools += Math.max(base, visual);
    }
  }
  const definitions = toolDefinitions(messages);
  return { input, response, reasoning, tools, summary, definitions, total: input + response + reasoning + tools + summary + definitions };
}
