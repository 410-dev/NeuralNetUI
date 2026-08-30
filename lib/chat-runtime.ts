import { canUseModel, readConfig } from "./config";
import { readConversation, writeConversation } from "./conversations";
import { readUploadDataUrl } from "./uploads";
import { currentTime, executeWebTool, reverseGeocode, toolDefinitions, type EnabledWebTools } from "./web-tools";
import type { Conversation, StoredMessage, ToolEvent } from "./types";

type InputMessage = { role: "user" | "assistant" | "system"; content: string; reasoning_content?: string; attachments?: Array<{ id: string }> };
type UpstreamMessage = { role: string; content: unknown; reasoning_content?: string; tool_calls?: unknown; tool_call_id?: string; name?: string };
type ToolCall = { id: string; function: { name: string; arguments: string }; type: "function" };
type JobStatus = "running" | "waiting" | "completed" | "stopped" | "error";

export type ChatJobSnapshot = {
  conversationId: string;
  branchId: string;
  status: JobStatus;
  message: StoredMessage;
  error?: string;
};

export type StartChatJobInput = {
  conversationId: string;
  branchId: string;
  assistantMessageId: string;
  revisionGroupId?: string;
  modelId: string;
  reasoningPresetId?: string;
  sendReasoning?: boolean;
  tools?: EnabledWebTools;
  messages: InputMessage[];
  clientContext?: { timeZone?: string; locale?: string };
};

type ChatJob = {
  userId: string;
  input: StartChatJobInput;
  status: JobStatus;
  message: StoredMessage;
  conversation: Conversation;
  controller: AbortController;
  subscribers: Set<ReadableStreamDefaultController<Uint8Array>>;
  waiting: Map<string, (value: unknown) => void>;
  error?: string;
  persistTimer?: ReturnType<typeof setTimeout>;
  broadcastTimer?: ReturnType<typeof setTimeout>;
};

declare global {
  var neuralChatJobs: Map<string, ChatJob> | undefined;
}

const jobs = globalThis.neuralChatJobs ?? new Map<string, ChatJob>();
globalThis.neuralChatJobs = jobs;
const encoder = new TextEncoder();

function endpoint(baseUrl: string) { return `${baseUrl.replace(/\/$/, "")}/chat/completions`; }
function loadEndpoint(baseUrl: string) { const url = new URL(baseUrl); url.pathname = `${url.pathname.replace(/\/$/, "").replace(/\/v1$/, "")}/api/inference/load`; url.search = ""; url.hash = ""; return url.toString(); }
function loadBody(sourceModel: string) {
  const separator = sourceModel.lastIndexOf(":"); const lastPathSeparator = Math.max(sourceModel.lastIndexOf("/"), sourceModel.lastIndexOf("\\"));
  return separator <= lastPathSeparator || separator === 1 ? { model_path: sourceModel } : { model_path: sourceModel.slice(0, separator), gguf_variant: sourceModel.slice(separator + 1) };
}
function parseArguments(value: string) { try { return JSON.parse(value || "{}"); } catch { return { _invalidJson: value }; } }
function token(value: unknown) { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined; }
function usageFrom(payload: Record<string, unknown>) {
  const value = payload.usage as Record<string, unknown> | undefined; if (!value) return {};
  const details = (value.completion_tokens_details || value.output_tokens_details) as Record<string, unknown> | undefined;
  return {
    inputTokens: token(value.prompt_tokens ?? value.input_tokens), outputTokens: token(value.completion_tokens ?? value.output_tokens),
    reasoningTokens: token(details?.reasoning_tokens), totalTokens: token(value.total_tokens),
  };
}

function snapshot(job: ChatJob): ChatJobSnapshot {
  return { conversationId: job.input.conversationId, branchId: job.input.branchId, status: job.status, message: job.message, ...(job.error ? { error: job.error } : {}) };
}

function send(controller: ReadableStreamDefaultController<Uint8Array>, value: ChatJobSnapshot | "done") {
  controller.enqueue(encoder.encode(`data: ${value === "done" ? "[DONE]" : JSON.stringify(value)}\n\n`));
}

function broadcast(job: ChatJob, immediate = false) {
  if (job.status === "running" || job.status === "waiting") schedulePersist(job);
  if (!immediate) {
    if (!job.broadcastTimer) job.broadcastTimer = setTimeout(() => { job.broadcastTimer = undefined; broadcast(job, true); }, 80);
    return;
  }
  if (job.broadcastTimer) { clearTimeout(job.broadcastTimer); job.broadcastTimer = undefined; }
  const value = snapshot(job);
  for (const subscriber of [...job.subscribers]) {
    try { send(subscriber, value); } catch { job.subscribers.delete(subscriber); }
  }
}

function conversationWithMessage(job: ChatJob) {
  const stamp = new Date().toISOString();
  return {
    ...job.conversation,
    updatedAt: stamp,
    branches: job.conversation.branches.map((branch) => branch.id === job.input.branchId
      ? { ...branch, messages: [...branch.messages.filter((message) => message.id !== job.message.id), job.message], updatedAt: stamp }
      : branch),
  };
}

async function persist(job: ChatJob) {
  if (job.persistTimer) { clearTimeout(job.persistTimer); job.persistTimer = undefined; }
  job.conversation = conversationWithMessage(job);
  await writeConversation(job.conversation, job.userId);
}

function schedulePersist(job: ChatJob) {
  if (job.persistTimer) return;
  job.persistTimer = setTimeout(() => { job.persistTimer = undefined; void persist(job).catch(() => undefined); }, 350);
}

function finishSubscribers(job: ChatJob) {
  for (const subscriber of [...job.subscribers]) {
    try { send(subscriber, "done"); subscriber.close(); } catch { /* disconnected browser */ }
  }
  job.subscribers.clear();
}

async function upstreamMessages(input: StartChatJobInput, userId: string, systemPrompt: string): Promise<UpstreamMessage[]> {
  const converted = await Promise.all(input.messages.filter((message) => message.content || message.attachments?.length).map(async (message) => {
    const attachments = message.role === "user" ? message.attachments || [] : [];
    const content = attachments.length ? [
      ...(message.content ? [{ type: "text", text: message.content }] : []),
      ...(await Promise.all(attachments.map(async ({ id }) => ({ type: "image_url", image_url: { url: await readUploadDataUrl(id, userId) } })))),
    ] : message.content;
    return { role: message.role, content, ...(input.sendReasoning && message.role === "assistant" && message.reasoning_content ? { reasoning_content: message.reasoning_content } : {}) };
  }));
  return [...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []), ...converted];
}

async function streamTurn(job: ChatJob, body: Record<string, unknown>, headers: Record<string, string>) {
  const response = await fetch(endpoint(String(body._baseUrl)), {
    method: "POST", headers, signal: job.controller.signal,
    body: JSON.stringify(Object.fromEntries(Object.entries(body).filter(([key]) => key !== "_baseUrl"))),
  });
  if (!response.ok) throw new Error((await response.text()) || `Model server responded with ${response.status}`);
  if (!response.body) throw new Error("The model server returned no response stream.");
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
  const calls = new Map<number, ToolCall>(); let content = ""; let reasoning = ""; let usage: Record<string, number | undefined> = {};
  let visibleStarted: number | undefined; let visibleEnded: number | undefined; let reasoningStarted: number | undefined; let reasoningEnded: number | undefined;
  const readPayload = (payload: Record<string, unknown>) => {
    usage = { ...usage, ...usageFrom(payload) };
    const choices = Array.isArray(payload.choices) ? payload.choices as Array<{ delta?: Record<string, unknown> }> : [];
    const delta = choices[0]?.delta || {};
    const contentDelta = typeof delta.content === "string" ? delta.content : "";
    const reasoningDelta = typeof (delta.reasoning_content ?? delta.reasoning) === "string" ? String(delta.reasoning_content ?? delta.reasoning) : "";
    const now = performance.now();
    if (contentDelta || reasoningDelta) { visibleStarted ??= now; visibleEnded = now; }
    if (reasoningDelta) { reasoningStarted ??= now; reasoningEnded = now; }
    content += contentDelta; reasoning += reasoningDelta;
    if (contentDelta || reasoningDelta) {
      job.message = { ...job.message, content: job.message.content + contentDelta, reasoning: (job.message.reasoning || "") + reasoningDelta };
      broadcast(job);
    }
    if (Array.isArray(delta.tool_calls)) for (const part of delta.tool_calls as Array<Record<string, unknown>>) {
      const index = typeof part.index === "number" ? part.index : calls.size;
      const fn = part.function as Record<string, unknown> | undefined;
      const previous = calls.get(index) || { id: "", type: "function" as const, function: { name: "", arguments: "" } };
      calls.set(index, {
        id: `${previous.id}${typeof part.id === "string" ? part.id : ""}` || `tool-${crypto.randomUUID()}`,
        type: "function",
        function: { name: `${previous.function.name}${typeof fn?.name === "string" ? fn.name : ""}`, arguments: `${previous.function.arguments}${typeof fn?.arguments === "string" ? fn.arguments : ""}` },
      });
    }
  };
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buffer += decoder.decode(value, { stream: true }); const records = buffer.split(/\r?\n\r?\n/); buffer = records.pop() || "";
    for (const record of records) for (const line of record.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue; const data = line.slice(5).trim(); if (!data || data === "[DONE]") continue;
      try { readPayload(JSON.parse(data)); } catch { /* keep-alive or vendor extension */ }
    }
  }
  if (buffer.trim()) for (const line of buffer.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue; const data = line.slice(5).trim(); if (!data || data === "[DONE]") continue;
    try { readPayload(JSON.parse(data)); } catch { /* ignore */ }
  }
  return {
    content, reasoning, calls: [...calls.values()], usage,
    visibleDurationSeconds: visibleStarted === undefined ? undefined : Math.max(.001, ((visibleEnded || performance.now()) - visibleStarted) / 1000),
    reasoningDurationSeconds: reasoningStarted === undefined ? 0 : Math.max(.001, ((reasoningEnded || performance.now()) - reasoningStarted) / 1000),
  };
}

function addToolEvent(job: ChatJob, call: ToolCall): ToolEvent {
  const event: ToolEvent = {
    id: call.id,
    name: call.function.name,
    status: "calling",
    reasoningOffset: job.message.reasoning?.length || 0,
    arguments: parseArguments(call.function.arguments),
    startedAt: new Date().toISOString(),
  };
  job.message = { ...job.message, toolEvents: [...(job.message.toolEvents || []), event] }; broadcast(job, true); return event;
}

function updateToolEvent(job: ChatJob, id: string, patch: Partial<ToolEvent>) {
  job.message = { ...job.message, toolEvents: (job.message.toolEvents || []).map((event) => event.id === id ? { ...event, ...patch } : event) }; broadcast(job, true);
}

function waitForBrowser(job: ChatJob, call: ToolCall) {
  job.status = "waiting"; updateToolEvent(job, call.id, { status: "waiting" });
  return new Promise<unknown>((resolve, reject) => {
    job.waiting.set(call.id, (value) => { job.waiting.delete(call.id); job.status = "running"; resolve(value); });
    job.controller.signal.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), { once: true });
  });
}

function validateQuestions(value: unknown) {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const questions = Array.isArray(record.questions) ? record.questions.slice(0, 3) : [];
  if (!questions.length) throw new Error("No multiple-choice questions were provided.");
  return { questions: questions.map((item, index) => {
    const question = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const options = Array.isArray(question.options) ? question.options.map(String).filter(Boolean).slice(0, 4) : [];
    if (options.length < 2) throw new Error("Each multiple-choice question needs 2 to 4 options.");
    const type = ["single_select", "multi_select", "rank_priorities"].includes(String(question.type)) ? String(question.type) : "single_select";
    return { id: `question-${index + 1}`, question: String(question.question || `Question ${index + 1}`), type, options };
  }) };
}

async function executeTool(job: ChatJob, call: ToolCall, enabled: EnabledWebTools) {
  const args = parseArguments(call.function.arguments);
  if (call.function.name === "get_current_time" && enabled.currentTime) return currentTime(job.input.clientContext?.timeZone, job.input.clientContext?.locale || "en-US");
  if (call.function.name === "get_current_location" && enabled.location) {
    const browserResult = await waitForBrowser(job, call);
    const value = browserResult && typeof browserResult === "object" ? browserResult as Record<string, unknown> : {};
    if (value.error) return { error: String(value.error) };
    return reverseGeocode(Number(value.latitude), Number(value.longitude), Number(value.accuracy));
  }
  if (call.function.name === "ask_multiple_choice" && enabled.multipleChoice) {
    const normalized = validateQuestions(args); updateToolEvent(job, call.id, { arguments: normalized });
    return waitForBrowser(job, call);
  }
  return executeWebTool(call.function.name, call.function.arguments, enabled);
}

async function run(job: ChatJob) {
  const requestStartedAt = performance.now(); let reasoningSeconds = 0;
  try {
    const config = await readConfig();
    const model = config.models.find((item) => item.id === job.input.modelId);
    if (!model || !canUseModel(model, { id: job.userId } as never)) throw new Error("The selected model is unavailable.");
    const preset = model.reasoningPresets.find((item) => item.id === job.input.reasoningPresetId);
    const modelPrompt = model.systemPrompt?.trim() || ""; const presetPrompt = preset?.kind === "custom" ? preset.systemPrompt?.trim() || "" : "";
    let systemPrompt = modelPrompt;
    if (presetPrompt) systemPrompt = preset?.systemPromptMode === "replace" ? presetPrompt : preset?.systemPromptMode === "prepend" ? [presetPrompt, modelPrompt].filter(Boolean).join("\n\n") : [modelPrompt, presetPrompt].filter(Boolean).join("\n\n");
    let messages: UpstreamMessage[] = await upstreamMessages(job.input, job.userId, systemPrompt);
    const apiKey = config.server.apiKey || process.env.OPENAI_API_KEY || "";
    const headers = { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) };
    if (config.preferences.onDemand) {
      const target = loadBody(model.sourceModel); const statusUrl = loadEndpoint(config.server.baseUrl).replace(/\/load$/, "/status");
      const statusResponse = await fetch(statusUrl, { headers, signal: job.controller.signal, cache: "no-store" });
      const status = statusResponse.ok ? await statusResponse.json().catch(() => ({})) : {};
      if (status.model_identifier !== target.model_path || (target.gguf_variant && status.gguf_variant !== target.gguf_variant)) {
        const loadResponse = await fetch(loadEndpoint(config.server.baseUrl), { method: "POST", headers, body: JSON.stringify(target), signal: job.controller.signal });
        if (!loadResponse.ok) throw new Error((await loadResponse.text()) || `Model load failed with ${loadResponse.status}`);
      }
    }
    const enabled: EnabledWebTools = {
      internetSearch: job.input.tools?.internetSearch === true, pageVisit: job.input.tools?.pageVisit === true,
      currentTime: job.input.tools?.currentTime === true, location: job.input.tools?.location === true, multipleChoice: job.input.tools?.multipleChoice === true,
    };
    const tools = toolDefinitions(enabled);
    for (let turn = 0; turn < 8; turn += 1) {
      const body: Record<string, unknown> = { _baseUrl: config.server.baseUrl, model: model.sourceModel, messages, stream: true, stream_options: { include_usage: true }, ...(preset?.effort ? { reasoning_effort: preset.effort } : {}), ...(tools.length ? { tools, tool_choice: "auto" } : {}) };
      const result = await streamTurn(job, body, headers); reasoningSeconds += result.reasoningDurationSeconds;
      if (!result.calls.length) {
        job.message = { ...job.message, ...result.usage, reasoningDurationSeconds: job.message.reasoning ? Math.max(1, reasoningSeconds) : undefined,
          completionDurationSeconds: result.visibleDurationSeconds,
          timeToFirstTokenSeconds: Math.max(0, (performance.now() - requestStartedAt - (result.visibleDurationSeconds || 0) * 1000) / 1000) };
        job.status = "completed"; await persist(job); broadcast(job, true); finishSubscribers(job); return;
      }
      messages.push({ role: "assistant", content: result.content, ...(result.reasoning ? { reasoning_content: result.reasoning } : {}), tool_calls: result.calls });
      for (const call of result.calls) {
        addToolEvent(job, call); let toolResult: unknown;
        try { toolResult = await executeTool(job, call, enabled); updateToolEvent(job, call.id, { status: "completed", result: toolResult, completedAt: new Date().toISOString() }); }
        catch (error) {
          if ((error as Error).name === "AbortError") throw error;
          toolResult = { error: error instanceof Error ? error.message : "Tool execution failed." };
          updateToolEvent(job, call.id, { status: "error", result: toolResult, completedAt: new Date().toISOString() });
        }
        messages.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: JSON.stringify(toolResult) });
      }
    }
    throw new Error("The model repeated tool calls too many times.");
  } catch (error) {
    const stopped = (error as Error).name === "AbortError" || job.controller.signal.aborted;
    job.status = stopped ? "stopped" : "error"; job.error = stopped ? undefined : error instanceof Error ? error.message : "Chat generation failed.";
    if (job.message.reasoning) job.message.reasoningDurationSeconds ||= Math.max(1, reasoningSeconds);
    await persist(job).catch(() => undefined); broadcast(job, true); finishSubscribers(job);
  }
}

export async function startChatJob(input: StartChatJobInput, userId: string) {
  const existing = jobs.get(input.conversationId);
  if (existing && existing.userId === userId && ["running", "waiting"].includes(existing.status)) return snapshot(existing);
  const conversation = await readConversation(input.conversationId, userId);
  if (!conversation) throw new Error("Conversation not found.");
  if (!conversation.branches.some((branch) => branch.id === input.branchId)) throw new Error("Conversation branch not found.");
  const job: ChatJob = {
    userId, input, conversation, status: "running", controller: new AbortController(), subscribers: new Set(), waiting: new Map(),
    message: { id: input.assistantMessageId, revisionGroupId: input.revisionGroupId, role: "assistant", content: "", reasoning: "", toolEvents: [], createdAt: new Date().toISOString() },
  };
  jobs.set(input.conversationId, job); void run(job); return snapshot(job);
}

export function getChatJob(conversationId: string, userId: string) {
  const job = jobs.get(conversationId); return job?.userId === userId ? job : undefined;
}

export function subscribeToChatJob(job: ChatJob) {
  let activeController: ReadableStreamDefaultController<Uint8Array> | undefined;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      activeController = controller;
      send(controller, snapshot(job));
      if (["completed", "stopped", "error"].includes(job.status)) { send(controller, "done"); controller.close(); return; }
      job.subscribers.add(controller);
    },
    cancel() { if (activeController) job.subscribers.delete(activeController); },
  });
}

export function submitChatToolInput(job: ChatJob, toolCallId: string, value: unknown) {
  const resolver = job.waiting.get(toolCallId); if (!resolver) throw new Error("This tool is not waiting for input."); resolver(value); return snapshot(job);
}

export function stopChatJob(job: ChatJob) { job.controller.abort(); }
