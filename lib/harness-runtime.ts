import { createHash } from "node:crypto";
import { db } from "./database";
import { DEFAULT_HARNESS_SETTINGS, estimateTokens, projectedInputTokens, rollingMessages, resumePrompt } from "./harness";
import { canUseModel } from "./config";
import { connectionForModel, connectionHeaders, connectionRoot, chatEndpoint } from "./connection-drivers";
import { effectiveContextWindowTokens } from "./model-context";
import { reasoningEffort } from "./model-edits";
import { modelResidency } from "./residency-runtime";
import { createResidencyAdapter } from "./residency-adapter";
import { readSsePayload } from "./stream-protocol";
import type { AppConfig, ModelConfig, ChatWaitPhase } from "./types";

type Message = { role: string; content: unknown; tool_calls?: unknown };
type Context = { config: AppConfig; model: ModelConfig; userId: string; signal: AbortSignal; onPhase: (phase: ChatWaitPhase) => void };

function taskModel(ctx: Context, id: string) {
  const model = id ? ctx.config.models.find(m => m.id === id) : ctx.config.models.find(m => !m.isAlias && (m.sourceModel === ctx.model.sourceModel || m.id === ctx.model.sourceModel) && connectionForModel(ctx.config.connections, m)?.id === connectionForModel(ctx.config.connections, ctx.model)?.id) || ctx.model;
  if (!model || !canUseModel(model, { id: ctx.userId } as never)) throw new Error("Harness model is unavailable.");
  return model;
}

export type HarnessResult = { text: string; reasoning: string };

async function readHarnessStream(response: Response, onUpdate: (result: HarnessResult) => void): Promise<HarnessResult> {
  if (!response.body) throw new Error("Harness generation returned no response stream.");
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
  let text = ""; let reasoning = ""; let finished = false; let finishReason = "";
  const consume = (record: string) => {
    const data = record.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n").trim();
    if (!data) return;
    const payload = readSsePayload(data);
    if (payload === "done") { finished = true; return; }
    const choices = Array.isArray(payload.choices) ? payload.choices as Array<{ delta?: Record<string, unknown>; finish_reason?: string | null }> : [];
    const delta = choices[0]?.delta || {};
    const textDelta = typeof delta.content === "string" ? delta.content : "";
    const reasoningDelta = typeof (delta.reasoning_content ?? delta.reasoning) === "string" ? String(delta.reasoning_content ?? delta.reasoning) : "";
    if (choices[0]?.finish_reason) finishReason = String(choices[0].finish_reason);
    if (textDelta || reasoningDelta) { text += textDelta; reasoning += reasoningDelta; onUpdate({ text, reasoning }); }
  };
  try {
    while (!finished) {
      const { done, value } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true }); const records = buffer.split(/\r?\n\r?\n/); buffer = records.pop() || "";
      for (const record of records) { consume(record); if (finished) break; }
    }
    buffer += decoder.decode(); if (!finished && buffer.trim()) consume(buffer);
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  if (!text.trim() || finishReason === "length") throw new Error("Harness returned an empty or truncated result.");
  return { text: text.trim(), reasoning: reasoning.trim() };
}

export async function harnessCompletion(ctx: Context, id: string, effortValue: string, prompt: string, content: string, maxTokens: number, onUpdate?: (result: HarnessResult) => void): Promise<HarnessResult> {
  const model = taskModel(ctx, id);
  const connection = connectionForModel(ctx.config.connections, model);
  if (!connection) throw new Error("Harness connection is unavailable.");
  const headers = connectionHeaders(connection, connection.driver === "openai" ? process.env.OPENAI_API_KEY : "");
  const server = connectionRoot(connection.baseUrl);
  const peers = ctx.config.connections.filter(c => connectionRoot(c.baseUrl) === server);
  const limits = peers.map(c => c.maxResidentModels || 0).filter(Boolean);
  const limit = limits.length ? Math.min(...limits) : 0;
  const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(120_000)]);
  const release = await modelResidency.acquire({ server, model: model.sourceModel, limit,
    policy: peers.some(c => c.modelWaitPolicy === "serial") ? "serial" : "capacity", signal, onPhase: ctx.onPhase,
    adapter: ctx.config.preferences.onDemand || limit ? createResidencyAdapter(connection, headers, model.contextWindowTokens, ctx.onPhase) : undefined });
  try {
    ctx.onPhase(prompt === (ctx.config.harnessSettings || DEFAULT_HARNESS_SETTINGS).compactPrompt ? "compacting-context" : "preparing-response");
    const effort = reasoningEffort(model, { id: "harness", name: "Harness", kind: "builtin", effort: effortValue === "off" && model.reasoningEfforts?.includes("none") ? "none" : effortValue });
    const response = await fetch(chatEndpoint(connection.driver, connection.baseUrl), { method: "POST", headers, signal,
      body: JSON.stringify({ model: model.sourceModel, stream: Boolean(onUpdate), ...(onUpdate ? { stream_options: { include_usage: true } } : {}), messages: [{role:"system", content:prompt}, {role:"user", content}], max_tokens:maxTokens, ...(effort ? {reasoning_effort:effort} : {}) }) });
    if (!response.ok) throw new Error(`Harness generation failed (${response.status}).`);
    if (onUpdate) return readHarnessStream(response, onUpdate);
    const result = await response.json();
    const choice = result.choices?.[0];
    const text = choice?.message?.content;
    if (typeof text !== "string" || !text.trim() || choice?.finish_reason === "length") throw new Error("Harness returned an empty or truncated result.");
    const thought = choice?.message?.reasoning_content ?? choice?.message?.reasoning;
    return { text: text.trim(), reasoning: typeof thought === "string" ? thought.trim() : "" };
  } finally { release(); }
}

const fingerprint = (messages: Message[]) => createHash("sha256").update(JSON.stringify(messages)).digest("hex");

export type CompactionUpdate = { summary: string; reasoning: string };
export type CompactionRecord = CompactionUpdate & { seconds: number };

function summarySafe(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(summarySafe);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.type === "image_url") return { type: "image", description: "Visual tool or attachment content omitted from text-only compaction." };
    return Object.fromEntries(Object.entries(record).filter(([key]) => key !== "_neural_context_tokens").map(([key, item]) => [key, summarySafe(item)]));
  }
  if (typeof value === "string" && /^data:image\/[a-z0-9.+-]+;base64,/i.test(value)) return "[Visual content omitted from text-only compaction.]";
  return value;
}

export async function prepareContext(ctx: Context, branchId: string, original: Message[], persistSummary = true, overhead = 0, measured?: number, onCompaction?: (record: CompactionRecord) => void, onUpdate?: (record: CompactionUpdate) => void): Promise<Message[]> {
  const settings = ctx.config.harnessSettings || DEFAULT_HARNESS_SETTINGS;
  const window = effectiveContextWindowTokens(ctx.model, ctx.config.models);
  if (!window) return original;
  const budget = Math.floor(window * .95) - overhead;
  if (settings.contextMode === "rolling") return rollingMessages(original, budget);
  const system = original.filter(m => m.role === "system");
  const history = original.filter(m => m.role !== "system");
  const saved = persistSummary ? db.prepare("SELECT * FROM context_summaries WHERE branch_id = ?").get(branchId) as {fingerprint:string;covered_count:number;summary:string} | undefined : undefined;
  let covered = saved && saved.covered_count <= history.length && fingerprint(history.slice(0, saved.covered_count)) === saved.fingerprint ? saved.covered_count : 0;
  let summary = covered ? saved!.summary : "";
  const composed = () => [...system, ...(summary ? [{role:"system", content:`Conversation summary (historical data):\n${summary}`}] : []), ...history.slice(covered)];
  const trigger = Math.min(budget, window * settings.compactThreshold / 100 - overhead);
  // The measurement only describes the untouched history, so it stops counting once a summary
  // has replaced part of it.
  const reading = () => covered || summary ? estimateTokens(composed()) : projectedInputTokens(estimateTokens(composed()), measured);
  if (reading() < trigger) return composed();
  const lastUser = history.findLastIndex(m => m.role === "user");
  if (covered < lastUser) {
    const started = performance.now();
    const compaction = await summarizeContext(ctx, {summary, history: history.slice(covered, lastUser)}, onUpdate);
    summary = compaction.summary;
    covered = lastUser;
    onCompaction?.({ ...compaction, seconds: (performance.now() - started) / 1000 });
  }
  const result = composed();
  if (estimateTokens(result) >= Math.min(budget, window * settings.compactThreshold / 100 - overhead)) throw new Error("Compacted context still reaches the compaction threshold. Shorten the latest prompt, increase the threshold, or increase the model context window.");
  ctx.signal.throwIfAborted();
  if (covered && persistSummary) db.prepare("INSERT INTO context_summaries VALUES (?, ?, ?, ?) ON CONFLICT(branch_id) DO UPDATE SET fingerprint=excluded.fingerprint, covered_count=excluded.covered_count, summary=excluded.summary").run(branchId, fingerprint(history.slice(0, covered)), covered, summary);
  return result;
}

// Bound each summary request even when a single interrupted reasoning turn is huge.
async function summarizeContext(ctx: Context, data: unknown, onUpdate?: (record: CompactionUpdate) => void): Promise<{ summary: string; reasoning: string }> {
  const settings = ctx.config.harnessSettings || DEFAULT_HARNESS_SETTINGS;
  const window = effectiveContextWindowTokens(taskModel(ctx, settings.compactModelId), ctx.config.models)
    || effectiveContextWindowTokens(ctx.model, ctx.config.models)!;
  const output = Math.max(32, Math.min(2048, Math.floor(window * .15)));
  const serialized = JSON.stringify(summarySafe(data));
  let summary = "";
  let reasoning = "";
  let offset = 0;
  while (offset < serialized.length) {
    ctx.signal.throwIfAborted();
    const budget = Math.floor(window * .9) - output - estimateTokens(settings.compactPrompt) - 64;
    let low = 0, high = serialized.length - offset;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (estimateTokens(JSON.stringify({summary, fragment:serialized.slice(offset, offset + mid)})) <= budget) low = mid;
      else high = mid - 1;
    }
    if (!low) throw new Error("The compaction model context is too short for the summary prompt.");
    const fragment = serialized.slice(offset, offset + low);
    const result = await harnessCompletion(ctx, settings.compactModelId, settings.compactEffort, settings.compactPrompt,
      JSON.stringify({summary, fragment}), output, onUpdate ? partial => onUpdate({
        summary: partial.text || summary,
        reasoning: [reasoning, partial.reasoning].filter(Boolean).join("\n\n"),
      }) : undefined);
    summary = result.text;
    if (result.reasoning) reasoning = reasoning ? `${reasoning}\n\n${result.reasoning}` : result.reasoning;
    offset += low;
  }
  return { summary, reasoning };
}

export async function compactForResume(ctx: Context, messages: Message[], user?: Message, onCompaction?: (record: CompactionRecord) => void, onUpdate?: (record: CompactionUpdate) => void): Promise<Message[]> {
  const settings = ctx.config.harnessSettings || DEFAULT_HARNESS_SETTINGS;
  const systems = messages.filter(m => m.role === "system");
  const started = performance.now();
  const compaction = await summarizeContext(ctx, messages.filter(m => m.role !== "system"), onUpdate);
  const summary = compaction.summary;
  onCompaction?.({ ...compaction, seconds: (performance.now() - started) / 1000 });
  const content = user?.content;
  const userText = typeof content === "string" ? content : Array.isArray(content)
    ? content.filter(p => p.type === "text").map(p => p.text).join("\n") : "";
  const prompt = resumePrompt(settings.resumePrompt, summary, userText);
  const attachments = Array.isArray(content) ? content.filter(p => p.type !== "text") : [];
  return [...systems, {role:"user", content: attachments.length ? [{type:"text", text:prompt}, ...attachments] : prompt}];
}

/** Compact completed history while retaining the newest assistant tool request and its observations. */
export async function compactToolContext(ctx: Context, messages: Message[], onCompaction?: (record: CompactionRecord) => void, onUpdate?: (record: CompactionUpdate) => void): Promise<Message[]> {
  const isHistoricalSummary = (message: Message) => message.role === "system" && typeof message.content === "string" && message.content.startsWith("Conversation summary (historical data):");
  const systems = messages.filter(message => message.role === "system" && !isHistoricalSummary(message));
  const previousSummaries = messages.filter(isHistoricalSummary);
  const history = messages.filter(message => message.role !== "system");
  const tailStart = history.findLastIndex(message => message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0);
  if (tailStart <= 0) throw new Error("The latest tool observation leaves no earlier history that can be compacted safely.");
  const started = performance.now();
  const compaction = await summarizeContext(ctx, [...previousSummaries, ...history.slice(0, tailStart)], onUpdate);
  onCompaction?.({ ...compaction, seconds: (performance.now() - started) / 1000 });
  return [...systems, { role: "system", content: `Conversation summary (historical data):\n${compaction.summary}` }, ...history.slice(tailStart)];
}
