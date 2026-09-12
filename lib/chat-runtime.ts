import { progressEvent } from "./inference-progress";
import { nativeChatResponse } from "./lm-studio-progress";
import { contextOverflowDetails, DEFAULT_HARNESS_SETTINGS, estimateTokens, projectedInputTokens, rollingMessages, contextThresholdReached } from "./harness";
import { contextUsage } from "./context-usage";
import { harnessCompletion, prepareContext, compactForResume, compactToolContext, type CompactionRecord, type CompactionUpdate } from "./harness-runtime";
import { effectiveContextWindowTokens } from "./model-context";
import { db } from "./database";
import { registerChatDisposal } from "./chat-disposal";
import { reasoningEffort } from "./model-edits";
import { restoreToolHistory, settlePendingTools } from "./conversation-messages";
import { readSsePayload } from "./stream-protocol";
import { canUseModel, readConfig } from "./config";
import { readConversation, writeConversation, renameConversation } from "./conversations";
import { readUploadModelContent } from "./uploads";
import { chatEndpoint, connectionForModel, connectionHeaders, connectionRoot } from "./connection-drivers";
import { createResidencyAdapter } from "./residency-adapter";
import { modelResidency } from "./residency-runtime";
import { progressFetch, SERVER_RESPONSE_TIMEOUT_MS, withSlowProgress } from "./chat-progress";
import { currentTime, executeWebTool, reverseGeocode, toolDefinitions, type EnabledWebTools } from "./web-tools";
import { assertOwnedBrowserSession, executeBrowserTool } from "./browser-tool";
import { deterministicHostAssessment, executeHostComputerTool, hostActionRequiresApproval, hostComputerToolDefinition, isShellHostAction, type HostRiskAssessment } from "./host-computer-tool";
import { canUseHostComputer } from "./host-environment";
import type { ChatWaitPhase, Conversation, HarnessSettings, MessageStep, StoredMessage, ToolEvent, ToolSettings, UserRole } from "./types";
import type { ModelContentPart } from "./document-processing";

type InputMessage = { role: "user" | "assistant" | "system"; content: string; reasoning_content?: string; toolEvents?: ToolEvent[]; attachments?: Array<{ id: string }> };
type UpstreamMessage = { role: string; content: unknown; reasoning_content?: string; tool_calls?: unknown; tool_call_id?: string; name?: string };
type ToolCall = { id: string; function: { name: string; arguments: string }; type: "function" };
type JobStatus = "running" | "waiting" | "completed" | "stopped" | "error";

export type ChatJobSnapshot = {
  conversationId: string;
  branchId: string;
  status: JobStatus;
  message: StoredMessage;
  error?: string;
  waitPhase?: ChatWaitPhase;
  waitProgress?: number;
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
  clientContext?: { timeZone?: string; locale?: string; language?: "en" | "ko" };
};

type ChatJob = {
  userId: string;
  userRole: UserRole;
  input: StartChatJobInput;
  status: JobStatus;
  message: StoredMessage;
  conversation: Conversation;
  controller: AbortController;
  subscribers: Set<ReadableStreamDefaultController<Uint8Array>>;
  waiting: Map<string, (value: unknown) => void>;
  error?: string;
  waitPhase?: ChatWaitPhase;
  waitProgress?: number;
  discarded?: boolean;
  unregister?: () => void;
  expiryTimer?: ReturnType<typeof setTimeout>;
  persistTimer?: ReturnType<typeof setTimeout>;
  broadcastTimer?: ReturnType<typeof setTimeout>;
};

declare global {
  var neuralChatJobs: Map<string, ChatJob> | undefined;
}

const jobs = globalThis.neuralChatJobs ?? new Map<string, ChatJob>();
globalThis.neuralChatJobs = jobs;
const encoder = new TextEncoder();

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

/** Appends streamed text to the open step of the same kind, or opens a new one. */
function appendStep(job: ChatJob, kind: "reasoning" | "content", text: string) {
  if (!text) return;
  const steps = job.message.steps ? [...job.message.steps] : [];
  const last = steps.at(-1);
  if (last && last.kind === kind) steps[steps.length - 1] = { ...last, text: last.text + text };
  else steps.push(kind === "reasoning" ? { kind, text } : { kind, text });
  job.message = { ...job.message, steps };
}

function pushStep(job: ChatJob, step: MessageStep) {
  job.message = { ...job.message, steps: [...(job.message.steps || []), step] };
}

/** Stamps the reasoning step that just ended with how long it ran. */
function closeReasoningStep(job: ChatJob, seconds: number) {
  const steps = job.message.steps ? [...job.message.steps] : [];
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step.kind === "reasoning") {
      if (step.seconds === undefined) { steps[index] = { ...step, seconds: Math.max(1, Math.round(seconds)) }; job.message = { ...job.message, steps }; }
      return;
    }
    if (step.kind === "content" || step.kind === "tools") return;
  }
}

/** Fills the compaction step opened when the phase began, or opens a finished one. */
function completeCompaction(job: ChatJob, record: CompactionRecord) {
  const steps = job.message.steps ? [...job.message.steps] : [];
  const open = steps.findLastIndex(step => step.kind === "compaction" && step.seconds === undefined);
  const retainedToolIds = open >= 0 && steps[open].kind === "compaction" ? steps[open].retainedToolIds : undefined;
  const finished: MessageStep = { kind: "compaction", seconds: Math.max(1, Math.round(record.seconds)), ...(record.summary ? { summary: record.summary } : {}), ...(record.reasoning ? { reasoning: record.reasoning } : {}), ...(retainedToolIds?.length ? { retainedToolIds } : {}) };
  if (open >= 0) steps[open] = finished; else steps.push(finished);
  job.message = { ...job.message, steps };
}

/** Streams the compaction model into the same open transcript fold that completion finalizes. */
function updateCompaction(job: ChatJob, record: CompactionUpdate) {
  const steps = job.message.steps ? [...job.message.steps] : [];
  let open = steps.findLastIndex(step => step.kind === "compaction" && step.seconds === undefined);
  if (open < 0) { steps.push({ kind: "compaction" }); open = steps.length - 1; }
  const current = steps[open];
  const retainedToolIds = current.kind === "compaction" ? current.retainedToolIds : undefined;
  steps[open] = { kind: "compaction", ...(record.summary ? { summary: record.summary } : {}), ...(record.reasoning ? { reasoning: record.reasoning } : {}), ...(retainedToolIds?.length ? { retainedToolIds } : {}) };
  job.message = { ...job.message, steps }; broadcast(job);
}

/** Mark the newest tool observation as retained while keeping the fold in chronological order. */
function beginToolCompaction(job: ChatJob) {
  const steps = job.message.steps ? [...job.message.steps] : [];
  if (steps.some(step => step.kind === "compaction" && step.seconds === undefined)) return;
  const latestTools = steps.findLastIndex(step => step.kind === "tools");
  const retainedToolIds = latestTools >= 0 && steps[latestTools].kind === "tools" ? steps[latestTools].ids : [];
  steps.push({ kind: "compaction", ...(retainedToolIds.length ? { retainedToolIds } : {}) });
  job.message = { ...job.message, steps };
}

function snapshot(job: ChatJob): ChatJobSnapshot {
  return { conversationId: job.input.conversationId, branchId: job.input.branchId, status: job.status, message: job.message, waitPhase: job.waitPhase, waitProgress: job.waitProgress, ...(job.error ? { error: job.error } : {}) };
}

function setWaitPhase(job: ChatJob, phase?: ChatWaitPhase) {
  if (job.discarded || job.controller.signal.aborted || !["running", "waiting"].includes(job.status) || job.waitPhase === phase) return;
  job.waitPhase = phase; job.waitProgress = undefined;
  if (phase === "compacting-context" && !(job.message.steps || []).some(step => step.kind === "compaction" && step.seconds === undefined)) pushStep(job, { kind: "compaction" });
  broadcast(job, true);
}

function setWaitProgress(job: ChatJob, phase: ChatWaitPhase, progress: number) {
  if (job.discarded || job.controller.signal.aborted || job.status !== "running" || !Number.isFinite(progress)) return;
  const percent = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  if (job.waitPhase === phase && job.waitProgress === percent) return;
  job.waitPhase = phase; job.waitProgress = percent;
  // A cached prompt may finish inside the text stream's 80ms batching interval.
  // Publish progress transitions before the first output clears them.
  broadcast(job, true);
}

function send(controller: ReadableStreamDefaultController<Uint8Array>, value: ChatJobSnapshot | "done") {
  controller.enqueue(encoder.encode(`data: ${value === "done" ? "[DONE]" : JSON.stringify(value)}\n\n`));
}

function broadcast(job: ChatJob, immediate = false) {
  if (job.discarded) return;
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
  await writeConversation(job.conversation, job.userId, () => !job.discarded && jobs.get(job.input.conversationId) === job);
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

async function upstreamMessages(input: StartChatJobInput, userId: string, systemPrompt: string, settings: ToolSettings): Promise<UpstreamMessage[]> {
  const converted = await Promise.all(input.messages.filter((message) => message.content || message.attachments?.length || message.toolEvents?.length).map(async (message) => {
    const attachments = message.role === "user" ? message.attachments || [] : [];
    const content = attachments.length ? [
      ...(message.content ? [{ type: "text", text: message.content }] : []),
      ...(await Promise.all(attachments.map(({ id }) => readUploadModelContent(id, userId, settings)))).flat(),
    ] : message.content;
    return restoreToolHistory({ role: message.role, content, toolEvents: message.toolEvents, ...(input.sendReasoning && message.role === "assistant" && message.reasoning_content ? { reasoning_content: message.reasoning_content } : {}) });
  }));
  return [...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []), ...converted.flat()];
}

async function streamTurn(job: ChatJob, body: Record<string, unknown>, headers: Record<string, string>, native?: { baseUrl: string; effort?: string }, allowProgress = false, threshold?: number, baseInput?: number) {
  const turnController = new AbortController();
  const signal = AbortSignal.any([job.controller.signal, turnController.signal]);
  setWaitPhase(job, "preparing-response");
  const nativeResponse = native ? await nativeChatResponse({ baseUrl: native.baseUrl, authorization: headers.Authorization, model: String(body.model), messages: body.messages as UpstreamMessage[], effort: native.effort, maxTokens: body.max_tokens as number | undefined, tools: body.tools as Parameters<typeof nativeChatResponse>[0]["tools"], signal }) : undefined;
  const response = nativeResponse || await progressFetch(String(body._endpoint), {
    method: "POST", headers, signal,
    body: JSON.stringify(Object.fromEntries(Object.entries(body).filter(([key]) => key !== "_endpoint")), (key, value) => key === "_neural_context_tokens" ? undefined : value),
  }, phase => setWaitPhase(job, phase), "preparing-response");
  if (!response.ok) throw new Error((await response.text()) || `Model server responded with ${response.status}`);
  if (!response.body) throw new Error("The model server returned no response stream.");
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
  const calls = new Map<number, ToolCall>(); let content = ""; let reasoning = ""; let usage: Record<string, number | undefined> = {};
  let visibleStarted: number | undefined; let visibleEnded: number | undefined; let reasoningStarted: number | undefined; let reasoningEnded: number | undefined;
  let compact = false;
  const inputEstimate = projectedInputTokens(estimateTokens(body.messages) + estimateTokens(body.tools || []), baseInput);
  let terminated = false; let sawPayload = false; let finishReason = false;
  const readPayload = (payload: Record<string, unknown>) => {
    sawPayload = true;
    const progress = allowProgress ? progressEvent(payload) : undefined;
    if (progress && !content && !reasoning && !calls.size) { setWaitProgress(job, progress.phase, progress.progress); return; }
    setWaitPhase(job, content || reasoning || calls.size ? undefined : "preparing-response");
    usage = { ...usage, ...usageFrom(payload) };
    const choices = Array.isArray(payload.choices) ? payload.choices as Array<{ delta?: Record<string, unknown>; finish_reason?: string | null }> : [];
    if (choices[0]?.finish_reason) finishReason = true;
    const delta = choices[0]?.delta || {};
    const contentDelta = typeof delta.content === "string" ? delta.content : "";
    const reasoningDelta = typeof (delta.reasoning_content ?? delta.reasoning) === "string" ? String(delta.reasoning_content ?? delta.reasoning) : "";
    const now = performance.now();
    if (contentDelta || reasoningDelta) { visibleStarted ??= now; visibleEnded = now; }
    if (reasoningDelta) { reasoningStarted ??= now; reasoningEnded = now; }
    content += contentDelta; reasoning += reasoningDelta;
    if (contentDelta || reasoningDelta) {
      setWaitPhase(job, undefined);
      job.message = { ...job.message, content: job.message.content + contentDelta, reasoning: (job.message.reasoning || "") + reasoningDelta };
      appendStep(job, "reasoning", reasoningDelta);
      if (contentDelta) { closeReasoningStep(job, (reasoningEnded ?? now) - (reasoningStarted ?? now) > 0 ? ((reasoningEnded ?? now) - (reasoningStarted ?? now)) / 1000 : 1); appendStep(job, "content", contentDelta); }
      broadcast(job);
    }
    if (Array.isArray(delta.tool_calls)) for (const part of delta.tool_calls as Array<Record<string, unknown>>) {
      setWaitPhase(job, undefined);
      const index = typeof part.index === "number" ? part.index : calls.size;
      const fn = part.function as Record<string, unknown> | undefined;
      const previous = calls.get(index) || { id: "", type: "function" as const, function: { name: "", arguments: "" } };
      calls.set(index, {
        id: `${previous.id}${typeof part.id === "string" ? part.id : ""}` || `tool-${crypto.randomUUID()}`,
        type: "function",
        function: { name: `${previous.function.name}${typeof fn?.name === "string" ? fn.name : ""}`, arguments: `${previous.function.arguments}${typeof fn?.arguments === "string" ? fn.arguments : ""}` },
      });
    }
    const used = Math.max(inputEstimate, usage.inputTokens ?? 0) + Math.max(
      estimateTokens(content) + estimateTokens(reasoning) + estimateTokens([...calls.values()]),
      usage.outputTokens ?? 0, usage.reasoningTokens ?? 0);
    job.message.contextTokens = used;
    if (threshold && used >= threshold) { compact = true; terminated = true; turnController.abort(); }
  };
  const consume = (record: string) => {
    const data = record.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n").trim();
    if (!data) return;
    const payload = readSsePayload(data);
    if (payload === "done") terminated = true;
    else readPayload(payload);
  };
  try {
    while (!terminated) {
      const { done, value } = await withSlowProgress(() => reader.read(), () => setWaitPhase(job, "waiting-server"), SERVER_RESPONSE_TIMEOUT_MS); if (done) break;
      buffer += decoder.decode(value, { stream: true }); const records = buffer.split(/\r?\n\r?\n/); buffer = records.pop() || "";
      for (const record of records) { consume(record); if (terminated) break; }
    }
    buffer += decoder.decode();
    if (!terminated && buffer.trim()) consume(buffer);
    if (!sawPayload || !terminated && !finishReason) throw new Error("The model response stream ended before completion.");
  } catch (error) {
    if (error instanceof Error && contextOverflowDetails(error) && Boolean(content || reasoning || calls.size))
      Object.assign(error, { neuralPartialOutput: true });
    throw error;
  } finally {
    setWaitPhase(job, undefined);
    await reader.cancel().catch(() => undefined); reader.releaseLock();
  }
  return {
    content, reasoning, calls: [...calls.values()], usage, compact,
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
  job.controller.signal.throwIfAborted();
  job.status = "waiting"; updateToolEvent(job, call.id, { status: "waiting" });
  return new Promise<unknown>((resolve, reject) => {
    const abort = () => { job.waiting.delete(call.id); reject(new DOMException("Stopped", "AbortError")); };
    job.waiting.set(call.id, (value) => { job.controller.signal.removeEventListener("abort", abort); job.waiting.delete(call.id); job.status = "running"; resolve(value); });
    job.controller.signal.addEventListener("abort", abort, { once: true });
  });
}

function parseHostAssessment(text: string): HostRiskAssessment {
  const candidate = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(candidate) as Record<string, unknown>;
  const riskLevel = Math.floor(Number(parsed.riskLevel)); const explanation = String(parsed.explanation || "").trim();
  if (![1, 2, 3, 4, 5].includes(riskLevel) || !explanation) throw new Error("The command assessor returned an invalid result.");
  return { riskLevel: riskLevel as HostRiskAssessment["riskLevel"], explanation };
}

type HostExecutionPolicy = {
  enabled: boolean;
  settings: HarnessSettings;
  locale: string;
  assessShell: (args: Record<string, unknown>) => Promise<HostRiskAssessment>;
};

async function authorizeHostAction(job: ChatJob, call: ToolCall, args: Record<string, unknown>, policy: HostExecutionPolicy) {
  if (!policy.enabled || job.userRole !== "superadmin") throw new Error("The host computer tool is restricted to Superadmin.");
  const assessment = isShellHostAction(args) ? await policy.assessShell(args) : deterministicHostAssessment(args, policy.locale);
  setWaitPhase(job, undefined);
  updateToolEvent(job, call.id, { arguments: { ...args, authorization: assessment } });
  if (!hostActionRequiresApproval(policy.settings, assessment.riskLevel)) return { approved: true, assessment };
  const response = await waitForBrowser(job, call);
  const value = response && typeof response === "object" ? response as Record<string, unknown> : {};
  const decision = String(value.decision || "reject");
  if (decision === "approve") return { approved: true, assessment };
  return { approved: false, assessment, result: { executed: false, rejected: true, decision: decision === "redirect" ? "redirect" : "reject", ...(decision === "redirect" && String(value.instruction || "").trim() ? { instruction: String(value.instruction).trim() } : {}) } };
}

function validateQuestions(value: unknown, maximum: number) {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const questions = Array.isArray(record.questions) ? record.questions.slice(0, maximum) : [];
  if (!questions.length) throw new Error("No multiple-choice questions were provided.");
  return { questions: questions.map((item, index) => {
    const question = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const options = Array.isArray(question.options) ? question.options.map(String).filter(Boolean).slice(0, 4) : [];
    if (options.length < 2) throw new Error("Each multiple-choice question needs 2 to 4 options.");
    const type = ["single_select", "multi_select", "rank_priorities"].includes(String(question.type)) ? String(question.type) : "single_select";
    return { id: `question-${index + 1}`, question: String(question.question || `Question ${index + 1}`), type, options };
  }) };
}

type ToolExecution = { result: unknown; content?: ModelContentPart[] };

async function executeTool(job: ChatJob, call: ToolCall, enabled: EnabledWebTools, settings: ToolSettings, hostPolicy: HostExecutionPolicy): Promise<ToolExecution> {
  const args = parseArguments(call.function.arguments);
  if (call.function.name === "get_current_time" && enabled.currentTime) return { result: currentTime(job.input.clientContext?.timeZone, job.input.clientContext?.locale || "en-US") };
  if (call.function.name === "get_current_location" && enabled.location) {
    const browserResult = await waitForBrowser(job, call);
    const value = browserResult && typeof browserResult === "object" ? browserResult as Record<string, unknown> : {};
    if (value.error) return { result: { error: String(value.error) } };
    return { result: await reverseGeocode(Number(value.latitude), Number(value.longitude), Number(value.accuracy)) };
  }
  if (call.function.name === "ask_multiple_choice" && enabled.multipleChoice) {
    const normalized = validateQuestions(args, settings.maxMultipleChoiceQuestions); updateToolEvent(job, call.id, { arguments: normalized });
    return { result: await waitForBrowser(job, call) };
  }
  if (call.function.name === "browser" && enabled.browser) {
    const ownerKey = `${job.userId}:${job.input.conversationId}`;
    if (String(args.action || "").toLowerCase() === "request_user") {
      const sessionId = String(args.session_id || "");
      assertOwnedBrowserSession(ownerKey, sessionId);
      const response = await waitForBrowser(job, call);
      return { result: { session_id: sessionId, ...(response && typeof response === "object" ? response as Record<string, unknown> : { completed: true }) } };
    }
    return executeBrowserTool(ownerKey, call.function.arguments, settings);
  }
  if (call.function.name === "host_computer") {
    const authorization = await authorizeHostAction(job, call, args, hostPolicy);
    if (!authorization.approved) return { result: authorization.result };
    return executeHostComputerTool(`${job.userId}:${job.input.conversationId}`, args);
  }
  return executeWebTool(call.function.name, call.function.arguments, enabled, settings);
}

async function run(job: ChatJob) {
  const requestStartedAt = performance.now(); let reasoningSeconds = 0;
  let releaseModel: (() => void) | undefined;
  try {
    const config = await readConfig();
    if (job.input.messages.some((message) => (message.attachments?.length || 0) > config.toolSettings.maxAttachmentsPerMessage)) throw new Error(`A message exceeds the configured ${config.toolSettings.maxAttachmentsPerMessage}-attachment limit.`);
    const model = config.models.find((item) => item.id === job.input.modelId);
    if (!model || !canUseModel(model, { id: job.userId } as never)) throw new Error("The selected model is unavailable.");
    const connection = connectionForModel(config.connections, model);
    if (!connection) throw new Error("The selected model's connection is unavailable.");
    const preset = model.reasoningPresets.find((item) => item.id === job.input.reasoningPresetId && (item.kind === "builtin" || !item.ownerId || item.ownerId === job.userId));
    const effort = reasoningEffort(model, preset);
    const modelPrompt = model.systemPrompt?.trim() || ""; const presetPrompt = preset?.kind === "custom" ? preset.systemPrompt?.trim() || "" : "";
    let systemPrompt = modelPrompt;
    if (presetPrompt) systemPrompt = preset?.systemPromptMode === "replace" ? presetPrompt : preset?.systemPromptMode === "prepend" ? [presetPrompt, modelPrompt].filter(Boolean).join("\n\n") : [modelPrompt, presetPrompt].filter(Boolean).join("\n\n");
    let messages: UpstreamMessage[] = await upstreamMessages(job.input, job.userId, systemPrompt, config.toolSettings);
    const enabled: EnabledWebTools = {
      internetSearch: job.input.tools?.internetSearch === true, pageVisit: job.input.tools?.pageVisit === true,
      browser: job.input.tools?.browser === true && config.experimental?.browserTool === true,
      currentTime: job.input.tools?.currentTime === true, location: job.input.tools?.location === true, multipleChoice: job.input.tools?.multipleChoice === true,
      hostComputer: job.input.tools?.hostComputer === true && canUseHostComputer(job.userRole, config.experimental?.hostComputerTool === true),
    };
    const tools = toolDefinitions(enabled, config.toolSettings);
    const harness = config.harnessSettings || DEFAULT_HARNESS_SETTINGS;
    const harnessContext = { config, model, userId: job.userId, signal: job.controller.signal, onPhase: (phase: ChatWaitPhase) => setWaitPhase(job, phase) };
    if (enabled.hostComputer) tools.push(hostComputerToolDefinition());
    const hostLocale = job.input.clientContext?.language === "ko" || job.input.clientContext?.locale?.toLowerCase().startsWith("ko") ? "ko" : "en";
    const hostPolicy: HostExecutionPolicy = {
      enabled: enabled.hostComputer === true, settings: harness, locale: hostLocale,
      assessShell: async args => {
        try {
          const request = JSON.stringify({ language: hostLocale === "ko" ? "Korean" : "English", shell: args.shell, command: args.command, cwd: args.cwd || null });
          const result = await harnessCompletion(harnessContext, harness.hostCommandModelId || job.input.modelId, harness.hostCommandEffort, harness.hostCommandAnalysisPrompt, request, 700);
          return parseHostAssessment(result.text);
        } catch (error) {
          job.controller.signal.throwIfAborted();
          return { riskLevel: 5, explanation: hostLocale === "ko" ? `명령어 “${String(args.command || "")}”의 독립 위험도 분석에 실패하여 가장 높은 5단계로 분류했습니다. 실행 시 지정된 ${String(args.shell || "shell")} 셸이 이 명령 전체를 처리합니다.` : `Independent analysis failed, so command “${String(args.command || "")}” was assigned the highest risk level 5. The selected ${String(args.shell || "shell")} shell will process the complete command if approved.` };
        }
      },
    };
    const firstResponse = !job.conversation.branches.some(b => b.messages.some(m => m.role === "assistant" && m.content));
    const generateTitle = async () => {
      if (!harness.titleEnabled || !firstResponse) return;
      const managed = db.prepare("SELECT title_managed FROM conversations WHERE id = ? AND user_id = ?").get(job.input.conversationId, job.userId) as {title_managed:number} | undefined;
      if (!managed || managed.title_managed) return;
      try {
        const first = job.input.messages.find(m => m.role === "user");
        const title = (await harnessCompletion(harnessContext, harness.titleModelId, harness.titleEffort, harness.titlePrompt, JSON.stringify({user:first?.content.slice(0, 2000), assistant:job.message.content.slice(0, 2000)}), 256)).text.split(/\r?\n/)[0].replace(/^["'#*]+|["'*]+$/g, "").trim().slice(0,200);
        job.controller.signal.throwIfAborted();
        if (title && renameConversation(job.input.conversationId, job.userId, title, true)) job.conversation.title = title;
      } catch (error) { if (job.controller.signal.aborted) throw error; /* A title failure must not discard a chat response. */ }
    };
    if (harness.titleTiming === "before") await generateTitle();
    const originalUser = messages.findLast(m => m.role === "user");
    // The composer's donut reads the stored counters; the same reading has to drive compaction,
    // or a request the interface calls 89% full is sent untouched.
    const branchMessages = (job.conversation.branches.find(item => item.id === job.input.branchId) || job.conversation.branches[0])?.messages || [];
    let measuredInput = contextUsage(branchMessages, job.input.sendReasoning === true, "", systemPrompt).total;
    let compactedBeforeSending = false;
    const messageCountBeforePreparation = messages.length;
    messages = await prepareContext(harnessContext, job.input.branchId, messages, true, estimateTokens(tools), measuredInput,
      record => { compactedBeforeSending = true; completeCompaction(job, record); }, record => updateCompaction(job, record));
    // A send-time compaction happened before any output, so it opens the transcript.
    if (compactedBeforeSending || messages.length !== messageCountBeforePreparation) { measuredInput = 0; if (compactedBeforeSending) broadcast(job, true); }
    let measuredEstimate = measuredInput > 0 ? estimateTokens(messages) + estimateTokens(tools) : undefined;
    job.message.contextTokens = estimateTokens(messages); broadcast(job, true);
    const headers = connectionHeaders(connection, connection.driver === "openai" ? process.env.OPENAI_API_KEY : "");
    const progressEnabled = connection.driver === "lmstudio" || config.experimental?.openAIProgress === true;
    let nativeServer = connection.driver === "lmstudio";
    if (!nativeServer && progressEnabled) {
      try {
        const probe = await fetch(`${connectionRoot(connection.baseUrl)}/api/v1/models`, { headers, signal: AbortSignal.any([job.controller.signal, AbortSignal.timeout(2000)]), cache: "no-store" });
        if (probe.ok) { const inventory = await probe.json(); nativeServer = Array.isArray(inventory.models) && inventory.models.some((m: {type?: string; key?: string; loaded_instances?: unknown}) => m.type === "llm" && typeof m.key === "string" && Array.isArray(m.loaded_instances)); }
      } catch { job.controller.signal.throwIfAborted(); }
    }
    const serverKey = connectionRoot(connection.baseUrl);
    const sameServer = config.connections.filter(item => connectionRoot(item.baseUrl) === serverKey);
    const limits = sameServer.map(item => item.maxResidentModels || 0).filter(limit => limit > 0);
    const limit = limits.length ? Math.min(...limits) : 0;
    const policy = sameServer.some(item => item.modelWaitPolicy === "serial") ? "serial" : "capacity";
    const adapter = config.preferences.onDemand || limit > 0 || nativeServer ? createResidencyAdapter(connection, headers, model.contextWindowTokens, phase => setWaitPhase(job, phase), fetch, nativeServer && progressEnabled ? progress => setWaitProgress(job, "loading-model", progress) : undefined) : undefined;
    const acquireModel = () => modelResidency.acquire({ server: serverKey, model: model.sourceModel, limit, policy, adapter, signal: job.controller.signal, onPhase: phase => setWaitPhase(job, phase) });
    releaseModel = await acquireModel();
    let compactionResumes = 0;
    const recordCompaction = (record: CompactionRecord) => { completeCompaction(job, record); broadcast(job, true); };
    const compactionError = () => new Error(config.preferences.language === "ko"
      ? "출력 중 컨텍스트 압축 재개 횟수를 초과했습니다. 압축 임계값이 너무 낮거나 모델의 컨텍스트 길이가 너무 짧습니다. 하네스 설정에서 임계값·재개 횟수 또는 모델 컨텍스트 길이를 늘려 주세요."
      : "Context compaction resume limit exceeded. The compaction threshold is too low or the model context window is too short. Increase the threshold, resume limit, or context window.");
    const overflowError = (details?: ReturnType<typeof contextOverflowDetails>) => new Error(config.preferences.language === "ko"
      ? `모델 입력 컨텍스트${details?.promptTokens ? ` ${details.promptTokens.toLocaleString()}토큰이` : "가"} 사용 가능한 범위${details?.contextWindow ? ` ${details.contextWindow.toLocaleString()}토큰을` : "를"} 초과했습니다. 자동 압축과 브라우저 결과 제한으로도 안전하게 줄일 수 없습니다. 전체 페이지 대신 현재 화면을 캡처하거나 페이지를 나누어 탐색해 주세요.`
      : `The model input${details?.promptTokens ? ` (${details.promptTokens.toLocaleString()} tokens)` : ""} exceeds the available context${details?.contextWindow ? ` (${details.contextWindow.toLocaleString()} tokens)` : ""} and could not be reduced safely by automatic compaction and browser-result limits. Capture the current viewport or browse the page in smaller sections.`);
    let detectedContextWindow: number | undefined;
    let skipToolCompactionOnce = false;
    for (let turn = 0; turn < config.toolSettings.maxToolRounds; turn += 1) {
      const configuredContextWindow = effectiveContextWindowTokens(model, config.models);
      const contextWindow = configuredContextWindow && detectedContextWindow ? Math.min(configuredContextWindow, detectedContextWindow) : configuredContextWindow || detectedContextWindow;
      let projectedInput = projectedInputTokens(estimateTokens(messages) + estimateTokens(tools), measuredInput, measuredEstimate);
      const skipToolCompaction = skipToolCompactionOnce; skipToolCompactionOnce = false;
      if (contextWindow && turn > 0 && !skipToolCompaction && harness.contextMode === "compacting" && projectedInput >= Math.min(contextWindow * .95, contextWindow * harness.compactThreshold / 100)) {
        releaseModel?.(); releaseModel = undefined;
        if (++compactionResumes > harness.maxCompactionResumes) throw compactionError();
        beginToolCompaction(job);
        try { messages = await compactToolContext(harnessContext, messages, recordCompaction, record => updateCompaction(job, record)); }
        catch (error) { job.controller.signal.throwIfAborted(); throw overflowError({ contextWindow }); }
        measuredInput = 0; measuredEstimate = undefined;
        projectedInput = estimateTokens(messages) + estimateTokens(tools);
        if (projectedInput > contextWindow * .95) throw overflowError({ promptTokens: projectedInput, contextWindow });
        releaseModel = await acquireModel();
      }
      if (contextWindow && harness.contextMode === "rolling") {
        const rolled = rollingMessages(messages, Math.floor(contextWindow * .95) - estimateTokens(tools));
        if (rolled.length !== messages.length) { measuredInput = 0; measuredEstimate = undefined; }
        messages = rolled; projectedInput = projectedInputTokens(estimateTokens(messages) + estimateTokens(tools), measuredInput, measuredEstimate);
      }
      if (contextWindow && projectedInput > contextWindow * .95) throw overflowError({ promptTokens: projectedInput, contextWindow });
      job.message.contextTokens = projectedInput;
      const remainingTokens = contextWindow ? Math.max(1, contextWindow - projectedInput - 32) : 0;
      const outputLimit = harness.maxOutputTokens > 0
        ? (remainingTokens ? Math.min(harness.maxOutputTokens, remainingTokens) : harness.maxOutputTokens)
        : remainingTokens;
      if (!releaseModel) releaseModel = await acquireModel();
      const body: Record<string, unknown> = { _endpoint: chatEndpoint(connection.driver, connection.baseUrl), model: model.sourceModel, messages, ...(outputLimit ? { max_tokens: outputLimit } : {}), stream: true, stream_options: { include_usage: true }, ...(effort ? { reasoning_effort: effort } : {}), ...(tools.length ? { tools, tool_choice: "auto" } : {}) };
      let result: Awaited<ReturnType<typeof streamTurn>>;
      try {
        const configuredThreshold = contextWindow ? Math.floor(contextWindow * harness.compactThreshold / 100) : undefined;
        const streamThreshold = configuredThreshold && projectedInput >= configuredThreshold && contextWindow ? Math.floor(contextWindow * .95) : configuredThreshold;
        result = await streamTurn(job, body, headers, nativeServer ? { baseUrl: connection.baseUrl, effort: model.reasoningSupported && model.reasoningEfforts?.includes(preset?.effort || "") ? preset?.effort : undefined } : undefined, progressEnabled, harness.contextMode === "compacting" ? streamThreshold : undefined, projectedInput);
      } catch (error) {
        const overflow = contextOverflowDetails(error);
        if (!overflow) throw error;
        if ((error as Error & { neuralPartialOutput?: boolean }).neuralPartialOutput) throw overflowError(overflow);
        const serverWindow = Math.min(contextWindow || Infinity, overflow.contextWindow || Infinity);
        const failedEstimate = estimateTokens(messages) + estimateTokens(tools);
        if (Number.isFinite(serverWindow)) detectedContextWindow = serverWindow;
        releaseModel?.(); releaseModel = undefined;
        if (harness.contextMode === "compacting" && Number.isFinite(serverWindow) && ++compactionResumes <= harness.maxCompactionResumes) {
          try {
            if (turn > 0) beginToolCompaction(job);
            messages = turn > 0
              ? await compactToolContext(harnessContext, messages, recordCompaction, record => updateCompaction(job, record))
              : await prepareContext(harnessContext, job.input.branchId, messages, false, estimateTokens(tools), overflow.promptTokens, recordCompaction, record => updateCompaction(job, record));
          } catch (compactionFailure) { job.controller.signal.throwIfAborted(); throw overflowError(overflow); }
          const compactedEstimate = estimateTokens(messages) + estimateTokens(tools);
          const correction = overflow.promptTokens ? Math.max(1, overflow.promptTokens / Math.max(1, failedEstimate)) : 1;
          measuredInput = Math.ceil(compactedEstimate * correction); measuredEstimate = compactedEstimate;
          if (projectedInputTokens(compactedEstimate, measuredInput, measuredEstimate) > serverWindow * .95) throw overflowError(overflow);
          releaseModel = await acquireModel(); skipToolCompactionOnce = turn > 0; turn -= 1; continue;
        }
        if (harness.contextMode === "rolling" && Number.isFinite(serverWindow) && overflow.promptTokens && overflow.promptTokens > serverWindow) {
          try {
            const estimated = estimateTokens(messages) + estimateTokens(tools);
            const scaledBudget = Math.floor(Math.min(serverWindow * .9, estimated * serverWindow * .85 / overflow.promptTokens)) - estimateTokens(tools);
            messages = rollingMessages(messages, scaledBudget);
          } catch { throw overflowError(overflow); }
          const rolledEstimate = estimateTokens(messages) + estimateTokens(tools);
          const correction = Math.max(1, overflow.promptTokens / Math.max(1, failedEstimate));
          measuredInput = Math.ceil(rolledEstimate * correction); measuredEstimate = rolledEstimate; turn -= 1; continue;
        }
        throw overflowError(overflow);
      }
      reasoningSeconds += result.reasoningDurationSeconds;
      const serverMeasuredInput = result.usage.inputTokens ? result.usage.inputTokens + (result.usage.outputTokens || 0) : undefined;
      if (result.compact) {
        job.controller.signal.throwIfAborted();
        releaseModel?.(); releaseModel = undefined;
        if (++compactionResumes > harness.maxCompactionResumes) throw compactionError();
        // Incomplete tool arguments are historical data only; never execute them.
        messages.push({ role: "assistant", content: result.content, reasoning_content: result.reasoning,
          ...(result.calls.length ? { tool_calls: result.calls } : {}) });
        messages = await compactForResume(harnessContext, messages, originalUser, recordCompaction, record => updateCompaction(job, record));
        measuredInput = 0; measuredEstimate = undefined;
        if (contextThresholdReached(estimateTokens(messages) + estimateTokens(tools), contextWindow, harness.compactThreshold)) throw compactionError();
        releaseModel = await acquireModel();
        turn -= 1; // Compaction retries do not consume the tool execution budget.
        continue;
      }
      if (!result.calls.length) {
        closeReasoningStep(job, reasoningSeconds);
        const toolEvents = job.message.toolEvents?.map(event => event.result && typeof event.result === "object" && Number.isFinite(Number((event.result as Record<string, unknown>).contextTokens))
          ? { ...event, result: { ...(event.result as Record<string, unknown>), contextTokensConsumed: true } } : event);
        job.message = { ...job.message, ...(toolEvents ? { toolEvents } : {}), ...result.usage, contextTokens: (result.usage.inputTokens ?? estimateTokens(messages)) + (result.usage.outputTokens ?? estimateTokens(result.content)), reasoningDurationSeconds: job.message.reasoning ? Math.max(1, reasoningSeconds) : undefined,
          completionDurationSeconds: result.visibleDurationSeconds,
          timeToFirstTokenSeconds: Math.max(0, (performance.now() - requestStartedAt - (result.visibleDurationSeconds || 0) * 1000) / 1000) };
        releaseModel?.(); releaseModel = undefined;
        if (harness.titleTiming === "after") await generateTitle();
        job.waitPhase = undefined; job.waitProgress = undefined; job.status = "completed"; await persist(job); broadcast(job, true); finishSubscribers(job); return;
      }
      messages.push({ role: "assistant", content: result.content, ...(result.reasoning ? { reasoning_content: result.reasoning } : {}), tool_calls: result.calls });
      if (serverMeasuredInput) { measuredInput = serverMeasuredInput; measuredEstimate = estimateTokens(messages) + estimateTokens(tools); }
      closeReasoningStep(job, result.reasoningDurationSeconds);
      pushStep(job, { kind: "tools", ids: result.calls.map(call => call.id) });
      broadcast(job, true);
      const visualToolContent: ModelContentPart[] = [];
      for (const call of result.calls) {
        addToolEvent(job, call); let execution: ToolExecution;
        // A host action may wait for approval or run an isolated assessment model. Do not hold
        // this chat's residency lease through either operation (serial policy would self-deadlock).
        if (call.function.name === "host_computer") { releaseModel?.(); releaseModel = undefined; }
        try { execution = await executeTool(job, call, enabled, config.toolSettings, hostPolicy); updateToolEvent(job, call.id, { status: "completed", result: execution.result, completedAt: new Date().toISOString() }); }
        catch (error) {
          if ((error as Error).name === "AbortError") throw error;
          execution = { result: { error: error instanceof Error ? error.message : "Tool execution failed." } };
          updateToolEvent(job, call.id, { status: "error", result: execution.result, completedAt: new Date().toISOString() });
        }
        const textContent = execution.content?.filter((part): part is Extract<ModelContentPart, { type: "text" }> => part.type === "text").map((part) => part.text).join("\n\n");
        messages.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: textContent || JSON.stringify(execution.result) });
        const images = execution.content?.filter((part): part is Extract<ModelContentPart, { type: "image_url" }> => part.type === "image_url") || [];
        if (images.length) visualToolContent.push({ type: "text", text: `Visual content returned by the ${call.function.name} tool:` }, ...images);
      }
      if (visualToolContent.length) messages.push({ role: "user", content: visualToolContent });
    }
    throw new Error("The model repeated tool calls too many times.");
  } catch (error) {
    const stopped = (error as Error).name === "AbortError" || job.controller.signal.aborted;
    job.message = settlePendingTools([job.message])[0];
    job.waitPhase = undefined; job.waitProgress = undefined;
    job.status = stopped ? "stopped" : "error"; job.error = stopped ? undefined : error instanceof Error ? error.message : "Chat generation failed.";
    if (job.message.reasoning) job.message.reasoningDurationSeconds ||= Math.max(1, reasoningSeconds);
    await persist(job).catch(() => undefined); broadcast(job, true); finishSubscribers(job);
  } finally {
    releaseModel?.();
    job.waiting.clear();
    job.input = { ...job.input, messages: [] };
    job.conversation = { ...job.conversation, branches: [] };
    if (!job.discarded && jobs.get(job.input.conversationId) === job) {
      job.expiryTimer = setTimeout(() => discardJob(job), 60_000);
      job.expiryTimer.unref();
      const completed = [...jobs.values()].filter(item => item.expiryTimer);
      for (const stale of completed.slice(0, Math.max(0, completed.length - 64))) discardJob(stale);
    }
  }
}

export async function startChatJob(input: StartChatJobInput, userId: string, userRole: UserRole = "user") {
  let existing = jobs.get(input.conversationId);
  if (existing && existing.userId === userId && ["running", "waiting"].includes(existing.status)) return snapshot(existing);
  const conversation = await readConversation(input.conversationId, userId);
  if (!conversation) throw new Error("Conversation not found.");
  if (!conversation.branches.some((branch) => branch.id === input.branchId)) throw new Error("Conversation branch not found.");
  existing = jobs.get(input.conversationId);
  if (existing && existing.userId === userId && ["running", "waiting"].includes(existing.status)) return snapshot(existing);
  const job: ChatJob = {
    userId, userRole, input, conversation, status: "running", waitPhase: "preparing-response", controller: new AbortController(), subscribers: new Set(), waiting: new Map(),
    message: { id: input.assistantMessageId, revisionGroupId: input.revisionGroupId, role: "assistant", content: "", reasoning: "", toolEvents: [], createdAt: new Date().toISOString() },
  };
  if (existing) discardJob(existing);
  jobs.set(input.conversationId, job);
  job.unregister = registerChatDisposal(input.conversationId, userId, () => discardJob(job));
  void run(job); return snapshot(job);
}

function discardJob(job: ChatJob) {
  job.discarded = true; job.controller.abort();
  if (job.persistTimer) clearTimeout(job.persistTimer);
  if (job.broadcastTimer) clearTimeout(job.broadcastTimer);
  if (job.expiryTimer) clearTimeout(job.expiryTimer);
  finishSubscribers(job); job.waiting.clear(); job.unregister?.();
  if (jobs.get(job.input.conversationId) === job) jobs.delete(job.input.conversationId);
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
