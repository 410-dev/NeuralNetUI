import { AuthError } from "./auth";
import { getChatJob, runtimeModel } from "./chat-runtime";
import { applyContextState, messageBeforeKeptTurns, type ContextState } from "./context-state";
import { loadContextState, saveContextState } from "./context-store";
import { readConfig } from "./config";
import { readConversation } from "./conversations";
import { DEFAULT_HARNESS_SETTINGS, estimateTokens } from "./harness";
import { summarizeContext } from "./harness-runtime";
import { effectiveContextWindowTokens } from "./model-context";
import { assertPlanAccess } from "./plans";
import type { StoredMessage } from "./types";

/**
 * /compact from the composer. "default" follows the context settings right away instead of waiting for the threshold:
 * drop details when Drop Details is on or the base method is rolling, then summarize when the base method is
 * compacting (if Drop Details was not enough, or is off). "summarize" always summarizes. Both keep the last
 * `compactKeepTurns` question-and-answer pairs word for word (fewer when the conversation is shorter, so the oldest
 * turn can still be folded). Summaries call a model and count toward the account's token usage. The result is stored
 * in the branch's context state.
 */
export type CompactMode = "default" | "summarize";
export type CompactResult = { state: ContextState; method: "drop" | "summary" | "none"; savedTokens: number; seconds: number; startedAt: number; summary?: string; reasoning?: string };

/** Text form of what the model would receive, for summaries and size estimates. */
function modelView(messages: StoredMessage[], state: ContextState, includeReasoning: boolean) {
  const applied = applyContextState(messages, state);
  const history = applied.entries.map(({ message }) => ({
    role: message.role,
    content: message.content,
    ...(includeReasoning && message.reasoning ? { reasoning: message.reasoning } : {}),
    ...(message.toolEvents?.length ? { tools: message.toolEvents.map(event => ({ name: event.name, arguments: event.arguments, result: event.result })) } : {}),
  }));
  return { summary: applied.summary || "", history };
}

export async function compactConversation(input: { userId: string; conversationId: string; branchId: string; mode: CompactMode; modelId?: string; aliasBaseModelId?: string; signal: AbortSignal; onUpdate?: (update: { summary: string; reasoning: string }) => void }): Promise<CompactResult> {
  const startedAt = Date.now();
  const conversation = await readConversation(input.conversationId, input.userId);
  const branch = conversation?.branches.find(item => item.id === input.branchId);
  if (!conversation || !branch) throw new AuthError("대화를 찾을 수 없습니다.", 404);
  const job = getChatJob(input.conversationId, input.userId);
  if (job && (job.status === "running" || job.status === "waiting")) throw new AuthError("응답을 생성하는 동안에는 컨텍스트를 압축할 수 없습니다.", 409);
  const messages = branch.messages;
  if (!messages.length) throw new AuthError("압축할 대화가 없습니다.", 400);
  const config = await readConfig();
  const harness = config.harnessSettings || DEFAULT_HARNESS_SETTINGS;
  // Everything before the kept pairs; the newest answer is complete, so no request is pending.
  const lastId = messageBeforeKeptTurns(messages, harness.compactKeepTurns ?? DEFAULT_HARNESS_SETTINGS.compactKeepTurns, false);
  if (!lastId) throw new AuthError("요약할 이전 대화가 없습니다. 최근 대화는 그대로 유지됩니다.", 400);
  const { model, selected, base } = runtimeModel(config, { modelId: input.modelId || conversation.modelId, aliasBaseModelId: input.aliasBaseModelId }, input.userId);
  const includeReasoning = (selected.rememberReasoning ?? base.rememberReasoning) === true;
  const size = (state: ContextState) => estimateTokens(modelView(messages, state, includeReasoning));
  const original = loadContextState(input.branchId);
  const before = size(original);
  let next = original;
  let method: CompactResult["method"] = "none";
  let reasoning = "";
  if (input.mode === "default" && (harness.dropDetailsFirst || harness.contextMode === "rolling")) {
    next = { ...next, droppedThroughMessageId: lastId };
    if (size(next) < before) method = "drop";
  }
  const window = effectiveContextWindowTokens(model, config.models);
  const trigger = window ? window * harness.compactThreshold / 100 : 0;
  const summarize = input.mode === "summarize" || harness.contextMode === "compacting" && (!harness.dropDetailsFirst || !trigger || size(next) >= trigger);
  if (summarize) {
    assertPlanAccess(input.userId, model.id, model.sourceModel);
    const through = messages.findIndex(message => message.id === lastId);
    const view = modelView(messages.slice(0, through + 1), next, includeReasoning);
    if (!view.history.length && !view.summary) throw new AuthError("요약할 대화가 없습니다.", 400);
    const compaction = await summarizeContext({ config, model, userId: input.userId, sessionId: input.conversationId, signal: input.signal, onPhase: () => undefined }, view, input.onUpdate);
    reasoning = compaction.reasoning;
    next = { ...next, summary: { text: compaction.summary, throughMessageId: lastId } };
    method = "summary";
  }
  saveContextState(input.branchId, next);
  return { state: next, method, savedTokens: Math.max(0, before - size(next)), startedAt, seconds: Math.max(1, Math.round((Date.now() - startedAt) / 1000)),
    ...(method === "summary" && next.summary ? { summary: next.summary.text } : {}), ...(reasoning ? { reasoning } : {}) };
}
