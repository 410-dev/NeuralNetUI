import { createHash } from "node:crypto";
import { db } from "./database";
import { DEFAULT_HARNESS_SETTINGS, estimateTokens, rollingMessages, resumePrompt } from "./harness";
import { canUseModel } from "./config";
import { connectionForModel, connectionHeaders, connectionRoot, chatEndpoint } from "./connection-drivers";
import { effectiveContextWindowTokens } from "./model-context";
import { reasoningEffort } from "./model-edits";
import { modelResidency } from "./residency-runtime";
import { createResidencyAdapter } from "./residency-adapter";
import type { AppConfig, ModelConfig, ChatWaitPhase } from "./types";

type Message = { role: string; content: unknown; tool_calls?: unknown };
type Context = { config: AppConfig; model: ModelConfig; userId: string; signal: AbortSignal; onPhase: (phase: ChatWaitPhase) => void };

function taskModel(ctx: Context, id: string) {
  const model = id ? ctx.config.models.find(m => m.id === id) : ctx.config.models.find(m => !m.isAlias && (m.sourceModel === ctx.model.sourceModel || m.id === ctx.model.sourceModel) && connectionForModel(ctx.config.connections, m)?.id === connectionForModel(ctx.config.connections, ctx.model)?.id) || ctx.model;
  if (!model || !canUseModel(model, { id: ctx.userId } as never)) throw new Error("Harness model is unavailable.");
  return model;
}

export async function harnessCompletion(ctx: Context, id: string, effortValue: string, prompt: string, content: string, maxTokens: number) {
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
      body: JSON.stringify({ model: model.sourceModel, stream: false, messages: [{role:"system", content:prompt}, {role:"user", content}], max_tokens:maxTokens, ...(effort ? {reasoning_effort:effort} : {}) }) });
    if (!response.ok) throw new Error(`Harness generation failed (${response.status}).`);
    const result = await response.json();
    const text = result.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim() || result.choices?.[0]?.finish_reason === "length") throw new Error("Harness returned an empty or truncated result.");
    return text.trim();
  } finally { release(); }
}

const fingerprint = (messages: Message[]) => createHash("sha256").update(JSON.stringify(messages)).digest("hex");

export async function prepareContext(ctx: Context, branchId: string, original: Message[], persistSummary = true, overhead = 0): Promise<Message[]> {
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
  if (estimateTokens(composed()) < Math.min(budget, window * settings.compactThreshold / 100 - overhead)) return composed();
  const lastUser = history.findLastIndex(m => m.role === "user");
  if (covered < lastUser) {
    summary = await summarizeContext(ctx, {summary, history: history.slice(covered, lastUser)});
    covered = lastUser;
  }
  const result = composed();
  if (estimateTokens(result) >= Math.min(budget, window * settings.compactThreshold / 100 - overhead)) throw new Error("Compacted context still reaches the compaction threshold. Shorten the latest prompt, increase the threshold, or increase the model context window.");
  ctx.signal.throwIfAborted();
  if (covered && persistSummary) db.prepare("INSERT INTO context_summaries VALUES (?, ?, ?, ?) ON CONFLICT(branch_id) DO UPDATE SET fingerprint=excluded.fingerprint, covered_count=excluded.covered_count, summary=excluded.summary").run(branchId, fingerprint(history.slice(0, covered)), covered, summary);
  return result;
}

// Bound each summary request even when a single interrupted reasoning turn is huge.
async function summarizeContext(ctx: Context, data: unknown): Promise<string> {
  const settings = ctx.config.harnessSettings || DEFAULT_HARNESS_SETTINGS;
  const window = effectiveContextWindowTokens(taskModel(ctx, settings.compactModelId), ctx.config.models)
    || effectiveContextWindowTokens(ctx.model, ctx.config.models)!;
  const output = Math.max(32, Math.min(2048, Math.floor(window * .15)));
  const serialized = JSON.stringify(data);
  let summary = "";
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
    summary = await harnessCompletion(ctx, settings.compactModelId, settings.compactEffort, settings.compactPrompt,
      JSON.stringify({summary, fragment}), output);
    offset += low;
  }
  return summary;
}

export async function compactForResume(ctx: Context, messages: Message[], user?: Message): Promise<Message[]> {
  const settings = ctx.config.harnessSettings || DEFAULT_HARNESS_SETTINGS;
  const systems = messages.filter(m => m.role === "system");
  const summary = await summarizeContext(ctx, messages.filter(m => m.role !== "system"));
  const content = user?.content;
  const userText = typeof content === "string" ? content : Array.isArray(content)
    ? content.filter(p => p.type === "text").map(p => p.text).join("\n") : "";
  const prompt = resumePrompt(settings.resumePrompt, summary, userText);
  const attachments = Array.isArray(content) ? content.filter(p => p.type !== "text") : [];
  return [...systems, {role:"user", content: attachments.length ? [{type:"text", text:prompt}, ...attachments] : prompt}];
}
