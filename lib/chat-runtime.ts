import { progressEvent } from "./inference-progress";
import { nativeChatResponse, observeLmStudioPrefill } from "./lm-studio-progress";
import { CONTINUE_AFTER_DROP_PROMPT, contextOverflowDetails, DEFAULT_HARNESS_SETTINGS, estimateTokens, projectedInputTokens, rollingMessages, contextThresholdReached, usesCompactionThreshold, VISUAL_TOOL_CONTENT_PREFIX } from "./harness";
import { contextUsage } from "./context-usage";
import { harnessCompletion, prepareContext, compactForResume, compactToolContext, dropContextDetails, rollContext, HISTORICAL_SUMMARY_PREFIX, type CompactionRecord, type CompactionUpdate } from "./harness-runtime";
import { applyContextState, messageBeforeLatestUser, type ContextState } from "./context-state";
import { loadContextState, updateContextState } from "./context-store";
import { effectiveContextWindowTokens } from "./model-context";
import { db } from "./database";
import { registerChatDisposal } from "./chat-disposal";
import { presetEffortValue, reasoningEffort } from "./model-edits";
import { presetVisibleTo } from "./reasoning-capabilities";
import { restoreToolHistory, settlePendingTools } from "./conversation-messages";
import { readSsePayload } from "./stream-protocol";
import { canUseModel, readConfig } from "./config";
import { aliasBaseModel, aliasWithBaseModel } from "./alias-base-model";
import { readConversation, writeConversation, renameConversation } from "./conversations";
import { DEFAULT_REPETITION_SETTINGS, detectTextRepetition, detectToolCallRepetition, normalizeRepetitionSettings, toolArgumentText, type RepetitionFinding, type RepetitionSettings } from "./repetition.ts";
import { readUpload, readUploadModelContent, saveGeneratedImage } from "./uploads";
import { chatEndpoint, chatHeaders, connectionForModel, connectionRoot, envApiKey, hasModelResidency } from "./connection-drivers";
import { chatFetcher, providerRequestBody } from "./provider-requests.ts";
import type { ConnectionConfig, ConnectionDriver } from "./types";
import { agentConversation } from "./agent/store";
import { BROWSER_ONLY_PROVIDERS } from "./agent/policy";
import type { ToolGate, ToolProviderSource } from "./tools/types";
import { routedModelLabel, deleteRemoteLmfSession, forgetLmfSession, isLmfSessionGone, LMF_SESSION_HEADER, lmfChargedInput, lmfSessionFrom, lmfSessionTtlMs, saveLmfSession, storedLmfSession } from "./lmf";
import { connectionEndpoints, routeConnection } from "./connection-routing";
import { readPersonalSampling, resolveSampling, samplingRequestFields, type SamplingParams } from "./sampling-params";
import { createResidencyAdapter } from "./residency-adapter";
import { modelResidency } from "./residency-runtime";
import { progressFetch, SERVER_RESPONSE_TIMEOUT_MS, withSlowProgress } from "./chat-progress";
import { resolveTools, toolSources } from "./tools";
import { managedToolsInstalled } from "./managed-tools";
import { streamingPhaseFor } from "./tools/catalog";
import { requestToolState, type ToolState } from "./tools/state";
import type { ToolExecution, ToolRequestContext } from "./tools/types";
import type { ChatWaitPhase, Conversation, MessageStep, ModelConfig, StoredMessage, ToolEvent, ToolSettings, UserRole } from "./types";
import type { ModelContentPart } from "./document-processing";
import { promises as fs } from "node:fs";
import { acquirePlanAdmission, assertPlanAccess, planDisabledToolIds, clearLiveTokenUsage, recordTokenUsage, releasePlanAdmission, remainingPlanOutputTokens, setLiveTokenUsage } from "./plans";
import { generateCompatibleImage } from "./image-generation";
import { createThinkingSplitter, effectiveThinkingTags, normalizeThinkingTags, type ThinkingTag } from "./thinking-tags";
import { canPersonalizeSystemPrompt, readModelSystemPrompts, readSystemPromptOverrides, resolveSystemPrompt } from "./system-prompt";
import { readUserPreferences } from "./auth";

type InputMessage = { id?: string; role: "user" | "assistant" | "system"; content: string; reasoning_content?: string; toolEvents?: ToolEvent[]; attachments?: Array<{ id: string }> };
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
  /** The latest loop found in this response; the client offers to stop, retry or ignore it. */
  repetition?: RepetitionFinding;
  /** Server clock (epoch ms) when the current wait phase began, for a live "n seconds" label. */
  waitPhaseStartedAt?: number;
  /** Server clock when this snapshot was made, so the browser can correct for its own clock. */
  serverTime: number;
};

export type StartChatJobInput = {
  conversationId: string;
  branchId: string;
  assistantMessageId: string;
  revisionGroupId?: string;
  modelId: string;
  /** Current per-chat base for an alias. Omitted models use the alias recommendation. */
  aliasBaseModelId?: string;
  reasoningPresetId?: string;
  /** This chat's own system prompts by model id, then reasoning preset id. */
  systemPromptOverrides?: Record<string, Record<string, string>>;
  sendReasoning?: boolean;
  /** Tool switches for this request: the provider format, or the legacy switch object from older clients. */
  tools?: ToolState | Record<string, unknown>;
  messages: InputMessage[];
  clientContext?: { timeZone?: string; locale?: string; language?: "en" | "ko" };
};

export function runtimeModel(config: Awaited<ReturnType<typeof readConfig>>, input: Pick<StartChatJobInput, "modelId" | "aliasBaseModelId">, userId: string) {
  const selected = config.models.find(model => model.id === input.modelId);
  if (!selected || !canUseModel(selected, { id: userId } as never)) throw new Error("The selected model is unavailable.");
  if (!selected.isAlias) return { selected, model: selected, base: selected };
  const base = aliasBaseModel(selected, config.models, input.aliasBaseModelId);
  if (!base || input.aliasBaseModelId && base.id !== input.aliasBaseModelId || base.visible === false || !canUseModel(base, { id: userId } as never)) throw new Error("The selected alias base model is unavailable.");
  return { selected, base, model: aliasWithBaseModel(selected, base, userId) };
}

/** Set by the agent runtime for its main chat and subagent sessions. */
export type AgentJobOptions = {
  mode: "main" | "sub";
  runId?: string;
  /** No one started this turn: tool calls follow the agent's automatic-run rules. */
  autonomous: boolean;
  /** Appended to the model's system prompt. */
  systemPrompt: string;
  /** Compaction threshold (share of the context window) that replaces the harness setting. */
  compactPercent: number;
  /** Tools on for this session; missing means the request's own. */
  toolState?: ToolState;
  /** Extra tool sources (the agent's own tools). */
  sources: ToolProviderSource[];
  gate?: ToolGate;
  /** A running tool call is cancelled after this long (time spent waiting for approval does not count). */
  toolTimeoutMs?: number;
  /** Called once when the reply ends, however it ends. `looped` means it was stopped for repeating itself and discarded. */
  onSettled?: (result: { status: JobStatus; content: string; error?: string; looped?: boolean }) => void;
};

type ChatJob = {
  agent?: AgentJobOptions;
  /** Set when an agent reply was stopped for repeating itself: it is dropped from the chat so it can be regenerated. */
  agentLoop?: RepetitionFinding;
  /** One controller per running tool call, so a single call can be cancelled without stopping the reply. */
  toolAborts?: Map<string, { controller: AbortController; reason?: string }>;
  /** Set for LMFuseFramework connections: the session this chat continues, created on the first turn. */
  lmf?: { connection: ConnectionConfig; model: string; sessionId?: string };
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
  repetitionRules: RepetitionSettings;
  /** Start/end pairs that mark reasoning inside the model's text, from the served model. */
  thinkingTags?: ThinkingTag[];
  thinkingTagsCross?: boolean;
  repetition?: RepetitionFinding;
  repetitionCheck: { size: number; at: number };
  startedAt: number;
  waitPhaseStartedAt?: number;
  /** The prompt-processing stage that just ended, waiting to be stamped on the reasoning step that follows it. */
  lastPromptSeconds?: number;
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
    cachedTokens: token((value.prompt_tokens_details as Record<string, unknown> | undefined)?.cached_tokens),
  };
}

/**
 * The agent's tools: code that runs in the person's browser is not offered to the agent until a virtual computer is
 * available, and automatic runs also leave out what only the person can answer there (questions, location).
 */
/** The agent always watches for loops: when every rule is off in harness settings it uses the defaults. */
function agentRepetitionRules(rules: RepetitionSettings, agent: boolean): RepetitionSettings {
  return agent && !Object.values(rules).some(rule => rule.enabled) ? DEFAULT_REPETITION_SETTINGS : rules;
}

/** Cancels one running tool call; the model receives a "cancelled" result and the reply continues. */
export function cancelChatTool(job: ChatJob, toolCallId: string, reason = "cancelled by the person") {
  const entry = job.toolAborts?.get(toolCallId);
  if (!entry || entry.controller.signal.aborted) return false;
  entry.reason = reason; entry.controller.abort();
  return true;
}

function agentToolState(state: ToolState, autonomous: boolean): ToolState {
  const off = Object.fromEntries([...BROWSER_ONLY_PROVIDERS].filter(id => autonomous || id === "code-runner").map(id => [id, { ...state.providers[id], enabled: false }]));
  return { version: 2, providers: { ...state.providers, ...off } };
}

/** Keeps the session id LMFuseFramework named for this chat, for the next turn and the next request. */
function rememberLmfSession(job: ChatJob, sessionId: string | undefined) {
  // Saving on every turn also marks the session as used now, which restarts its TTL.
  if (!job.lmf || !sessionId) return;
  job.lmf.sessionId = sessionId;
  try { saveLmfSession(job.input.conversationId, job.lmf.connection.id, job.lmf.model, sessionId); }
  catch (error) { console.error("Unable to store the LMFuseFramework session", error); }
}

/** Appends streamed text to the open step of the same kind, or opens a new one. */
function appendStep(job: ChatJob, kind: "reasoning" | "content", text: string) {
  if (!text) return;
  const steps = job.message.steps ? [...job.message.steps] : [];
  const last = steps.at(-1);
  if (last && last.kind === kind) steps[steps.length - 1] = { ...last, text: last.text + text };
  else {
    steps.push(kind === "reasoning" ? { kind, text, startedAt: Date.now(), ...(job.lastPromptSeconds ? { promptSeconds: roundTenth(job.lastPromptSeconds) } : {}) } : { kind, text });
    job.lastPromptSeconds = undefined;
  }
  job.message = { ...job.message, steps };
}

const roundTenth = (seconds: number) => Math.round(seconds * 10) / 10;

/**
 * Times wait phases. Leaving a prompt-processing stage adds it to the message's total and keeps it for the reasoning
 * step that follows; stages are not merged, so each one is shown on its own.
 */
function trackPhase(job: ChatJob, next?: ChatWaitPhase) {
  if (job.waitPhase === next) return;
  const now = Date.now();
  if (job.waitPhase === "processing-prompt" && job.waitPhaseStartedAt) {
    const seconds = Math.max(0, (now - job.waitPhaseStartedAt) / 1000);
    job.message = { ...job.message, promptProcessingSeconds: roundTenth((job.message.promptProcessingSeconds || 0) + seconds) };
    job.lastPromptSeconds = seconds;
  }
  job.waitPhaseStartedAt = next ? now : undefined;
}

/** Stamps how long the whole response took, from the request reaching the server. */
function stampTotalDuration(job: ChatJob) {
  job.message = { ...job.message, totalDurationSeconds: roundTenth(Math.max(0, (Date.now() - job.startedAt) / 1000)) };
}

function pushStep(job: ChatJob, step: MessageStep) {
  if (step.kind === "tools") job.lastPromptSeconds = undefined;
  job.message = { ...job.message, steps: [...(job.message.steps || []), step] };
}

/** Stamps the reasoning step that just ended with how long it ran. */
function closeReasoningStep(job: ChatJob, seconds: number) {
  const steps = job.message.steps ? [...job.message.steps] : [];
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step.kind === "reasoning") {
      // Measured on the same clock the live counter uses (from the step's start), so the finished time never reads lower.
      const wall = step.startedAt !== undefined ? (Date.now() - step.startedAt) / 1000 : 0;
      if (step.seconds === undefined) { steps[index] = { ...step, seconds: Math.max(1, Math.ceil(Math.max(seconds, wall))) }; job.message = { ...job.message, steps }; }
      return;
    }
    if (step.kind === "content" || step.kind === "tools") return;
  }
}

/** Fills the compaction step opened when the phase began, or opens a finished one. */
function completeCompaction(job: ChatJob, record: CompactionRecord) {
  const steps = job.message.steps ? [...job.message.steps] : [];
  const open = steps.findLastIndex(step => step.kind === "compaction" && step.seconds === undefined);
  const current = open >= 0 && steps[open].kind === "compaction" ? steps[open] : undefined;
  const seconds = Math.max(1, Math.round(record.seconds));
  const finished: MessageStep = { kind: "compaction", seconds, startedAt: current?.startedAt ?? Date.now() - seconds * 1000,
    ...(record.method ? { method: record.method } : {}), ...(record.savedTokens !== undefined ? { savedTokens: Math.round(record.savedTokens) } : {}),
    ...(record.summary ? { summary: record.summary } : {}), ...(record.reasoning ? { reasoning: record.reasoning } : {}), ...(current?.retainedToolIds?.length ? { retainedToolIds: current.retainedToolIds } : {}) };
  if (open >= 0) steps[open] = finished; else steps.push(finished);
  job.message = { ...job.message, steps };
}

/** Streams the compaction model into the same open transcript fold that completion finalizes. */
function updateCompaction(job: ChatJob, record: CompactionUpdate) {
  const steps = job.message.steps ? [...job.message.steps] : [];
  let open = steps.findLastIndex(step => step.kind === "compaction" && step.seconds === undefined);
  if (open < 0) { steps.push({ kind: "compaction", startedAt: Date.now() }); open = steps.length - 1; }
  const current = steps[open];
  const retainedToolIds = current.kind === "compaction" ? current.retainedToolIds : undefined;
  const startedAt = current.kind === "compaction" ? current.startedAt ?? Date.now() : Date.now();
  steps[open] = { kind: "compaction", startedAt, ...(record.summary ? { summary: record.summary } : {}), ...(record.reasoning ? { reasoning: record.reasoning } : {}), ...(retainedToolIds?.length ? { retainedToolIds } : {}) };
  job.message = { ...job.message, steps }; broadcast(job);
}

/** Mark the newest tool observation as retained while keeping the fold in chronological order. */
function beginToolCompaction(job: ChatJob) {
  const steps = job.message.steps ? [...job.message.steps] : [];
  if (steps.some(step => step.kind === "compaction" && step.seconds === undefined)) return;
  const latestTools = steps.findLastIndex(step => step.kind === "tools");
  const retainedToolIds = latestTools >= 0 && steps[latestTools].kind === "tools" ? steps[latestTools].ids : [];
  steps.push({ kind: "compaction", startedAt: Date.now(), ...(retainedToolIds.length ? { retainedToolIds } : {}) });
  job.message = { ...job.message, steps };
}

function snapshot(job: ChatJob): ChatJobSnapshot {
  return { conversationId: job.input.conversationId, branchId: job.input.branchId, status: job.status, message: job.message, waitPhase: job.waitPhase, waitProgress: job.waitProgress, ...(job.repetition ? { repetition: job.repetition } : {}), ...(job.waitPhase && job.waitPhaseStartedAt ? { waitPhaseStartedAt: job.waitPhaseStartedAt } : {}), serverTime: Date.now(), ...(job.error ? { error: job.error } : {}) };
}

/**
 * Looks for a loop in the reasoning, the answer, the tool calls made so far and the arguments of calls still
 * streaming. Runs at most every 120 new characters or second; a new or grown finding is broadcast.
 */
function inspectRepetition(job: ChatJob, streamingCalls: ToolCall[] = [], force = false) {
  const rules = job.repetitionRules;
  if (job.discarded || !Object.values(rules).some(rule => rule.enabled)) return;
  const argumentText = streamingCalls.map(call => toolArgumentText(call.function.arguments)).join("\n\n");
  const size = job.message.content.length + (job.message.reasoning?.length || 0) + argumentText.length + (job.message.toolEvents?.length || 0) * 1000;
  const now = Date.now();
  if (!force && size - job.repetitionCheck.size < 120 && now - job.repetitionCheck.at < 1000) return;
  job.repetitionCheck = { size, at: now };
  const found = detectTextRepetition(job.message.reasoning || "", "reasoning", rules)
    || detectTextRepetition(job.message.content, "content", rules)
    || detectToolCallRepetition((job.message.toolEvents || []).map(event => ({ name: event.name, arguments: event.arguments })), rules)
    || (argumentText ? detectTextRepetition(argumentText, "tool", rules) : undefined);
  if (!found || found.id === job.repetition?.id && found.count === job.repetition.count) return;
  // The agent has no one to press "retry": the looping reply is discarded and the agent runtime regenerates it.
  if (job.agent) { job.agentLoop = found; job.controller.abort(); return; }
  job.repetition = found; broadcast(job, true);
}

function setWaitPhase(job: ChatJob, phase?: ChatWaitPhase) {
  if (job.discarded || job.controller.signal.aborted || !["running", "waiting"].includes(job.status) || job.waitPhase === phase) return;
  trackPhase(job, phase); job.waitPhase = phase; job.waitProgress = undefined;
  if (phase === "compacting-context" && !(job.message.steps || []).some(step => step.kind === "compaction" && step.seconds === undefined)) pushStep(job, { kind: "compaction" });
  broadcast(job, true);
}

function setWaitProgress(job: ChatJob, phase: ChatWaitPhase, progress: number) {
  if (job.discarded || job.controller.signal.aborted || job.status !== "running" || !Number.isFinite(progress)) return;
  const percent = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  if (job.waitPhase === phase && job.waitProgress === percent) return;
  trackPhase(job, phase); job.waitPhase = phase; job.waitProgress = percent;
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
      ? { ...branch, messages: [...branch.messages.filter((message) => message.id !== job.message.id), ...(job.agentLoop ? [] : [job.message])], updatedAt: stamp }
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

async function upstreamMessages(input: StartChatJobInput, userId: string, systemPrompt: string, settings: ToolSettings, model: ModelConfig): Promise<UpstreamMessage[]> {
  const converted = await Promise.all(input.messages.filter((message) => message.content || message.attachments?.length || message.toolEvents?.length).map(async (message) => {
    const attachments = message.role === "user" ? message.attachments || [] : [];
    const attachmentContent = attachments.length ? (await Promise.all(attachments.map(({ id }) => readUploadModelContent(id, userId, settings, model)))).flat() : [];
    if (model.imageInput === false && attachmentContent.some(part => part.type === "image_file" || part.type === "image_url")) throw new Error("The selected model does not accept image input.");
    const content = attachments.length ? [...(message.content ? [{ type: "text", text: message.content }] : []), ...attachmentContent] : message.content;
    return restoreToolHistory({ role: message.role, content, toolEvents: message.toolEvents, ...(input.sendReasoning && message.role === "assistant" && message.reasoning_content ? { reasoning_content: message.reasoning_content } : {}) });
  }));
  return [...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []), ...converted.flat()];
}

/** OpenAI-compatible HTTP has no local-file primitive; materialize only for that fallback path. */
async function materializeImageFiles(body: Record<string, unknown>) {
  const messages = Array.isArray(body.messages) ? body.messages as UpstreamMessage[] : [];
  const converted = await Promise.all(messages.map(async message => {
    if (!Array.isArray(message.content)) return message;
    const content = await Promise.all(message.content.map(async (part: Record<string, unknown>) => {
      if (part.type !== "image_file" || typeof part.file_path !== "string" || typeof part.mime_type !== "string") return part;
      const data = await fs.readFile(part.file_path);
      return { type:"image_url", image_url:{ url:`data:${part.mime_type};base64,${data.toString("base64")}` }, ...(part._neural_context_tokens ? { _neural_context_tokens:part._neural_context_tokens } : {}) };
    }));
    return { ...message, content };
  }));
  return { ...body, messages:converted };
}

async function streamTurn(job: ChatJob, body: Record<string, unknown>, headers: Record<string, string>, native?: { baseUrl: string; effort?: string; sampling?: SamplingParams }, allowProgress = false, threshold?: number, baseInput?: number, chargeModelId?: string, pollLmStudioStatus = false) {
  const turnController = new AbortController();
  const signal = AbortSignal.any([job.controller.signal, turnController.signal]);
  const prefillTimerController = new AbortController();
  let prefillSeen = false; let outputStarted = false; let statusPollStarted = false;
  setWaitPhase(job, "preparing-response");
  const statusPollController = new AbortController();
  const stopStatusPoll = () => statusPollController.abort();
  const startStatusPoll = () => {
    if (!pollLmStudioStatus || !native || statusPollStarted || signal.aborted) return;
    statusPollStarted = true;
    void observeLmStudioPrefill(native.baseUrl, String(body.model), AbortSignal.any([signal, statusPollController.signal]), () => {
      if (outputStarted || prefillSeen) return;
      prefillSeen = true;
      prefillTimerController.abort();
      setWaitPhase(job, "processing-prompt");
      stopStatusPoll();
    }, headers.Authorization).catch(() => undefined);
  };
  const setResponsePhase = (phase: ChatWaitPhase) => {
    if (prefillSeen && !outputStarted && (phase === "preparing-response" || phase === "waiting-server")) return;
    setWaitPhase(job, phase);
  };
  let response: Response;
  try {
    const nativeResponse = native ? await nativeChatResponse({ baseUrl: native.baseUrl, authorization: headers.Authorization, model: String(body.model), messages: body.messages as UpstreamMessage[], effort: native.effort, sampling: native.sampling, maxTokens: body.max_tokens as number | undefined, tools: body.tools as Parameters<typeof nativeChatResponse>[0]["tools"], signal, onInferenceStart: startStatusPoll }) : undefined;
    const httpBody = nativeResponse ? body : await materializeImageFiles(body);
    if (!nativeResponse) startStatusPoll();
    const driver = (typeof body._driver === "string" ? body._driver : "openai") as ConnectionDriver;
    const send = () => progressFetch(String(body._endpoint), {
      method: "POST", signal,
      // An LMFuseFramework chat continues its session; the first turn asks the server to open one.
      headers: job.lmf ? { ...headers, [LMF_SESSION_HEADER]: job.lmf.sessionId || "new" } : headers,
      body: JSON.stringify(providerRequestBody(driver, Object.fromEntries(Object.entries(httpBody).filter(([key]) => key !== "_endpoint" && key !== "_driver"))), (key, value) => key === "_neural_context_tokens" ? undefined : value),
    }, setResponsePhase, "preparing-response", chatFetcher(driver), SERVER_RESPONSE_TIMEOUT_MS, prefillTimerController.signal);
    response = nativeResponse || await send();
    if (!response.ok && job.lmf?.sessionId) {
      const detail = await response.text();
      // The stored session was closed or expired on the server: start a new one from the full history this request carries.
      if (!isLmfSessionGone(response.status, detail)) throw new Error(detail || `Model server responded with ${response.status}`);
      forgetLmfSession(job.input.conversationId, job.lmf.connection.id, job.lmf.model); job.lmf.sessionId = undefined;
      response = await send();
    }
    if (!response.ok) throw new Error((await response.text()) || `Model server responded with ${response.status}`);
    rememberLmfSession(job, lmfSessionFrom(response.headers));
    if (!response.body) throw new Error("The model server returned no response stream.");
  } catch (error) { stopStatusPoll(); throw error; }
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
  const calls = new Map<number, ToolCall>(); let content = ""; let reasoning = ""; let usage: Record<string, number | undefined> = {};
  let visibleStarted: number | undefined; let visibleEnded: number | undefined; let reasoningStarted: number | undefined; let reasoningEnded: number | undefined;
  let compact = false;
  const inputEstimate = projectedInputTokens(estimateTokens(body.messages) + estimateTokens(body.tools || []), baseInput);
  let terminated = false; let sawPayload = false; let finishReason = false;
  // Servers that omit usage are charged the local estimate; a live copy feeds manual usage refreshes.
  let chargedUsage = { inputTokens: 0, outputTokens: 0 };
  const thinking = createThinkingSplitter(job.thinkingTags ?? effectiveThinkingTags(undefined), { cross: job.thinkingTagsCross });
  const emitText = (contentDelta: string, reasoningDelta: string) => {
    const now = performance.now();
    if (contentDelta || reasoningDelta) { visibleStarted ??= now; visibleEnded = now; }
    if (reasoningDelta) { reasoningStarted ??= now; reasoningEnded = now; }
    content += contentDelta; reasoning += reasoningDelta;
    if (contentDelta || reasoningDelta) {
      outputStarted = true; stopStatusPoll();
      setWaitPhase(job, undefined);
      job.message = { ...job.message, content: job.message.content + contentDelta, reasoning: (job.message.reasoning || "") + reasoningDelta };
      appendStep(job, "reasoning", reasoningDelta);
      if (contentDelta) { closeReasoningStep(job, (reasoningEnded ?? now) - (reasoningStarted ?? now) > 0 ? ((reasoningEnded ?? now) - (reasoningStarted ?? now)) / 1000 : 1); appendStep(job, "content", contentDelta); }
      broadcast(job);
    }
  };
  const readPayload = (payload: Record<string, unknown>) => {
    sawPayload = true;
    if (job.lmf) rememberLmfSession(job, lmfSessionFrom(undefined, payload));
    const progress = allowProgress ? progressEvent(payload) : undefined;
    if (progress && !content && !reasoning && !calls.size) {
      if (progress.phase === "processing-prompt") { prefillSeen = true; prefillTimerController.abort(); stopStatusPoll(); }
      setWaitProgress(job, progress.phase, progress.progress); return;
    }
    if (payload.type === "tool_call.name") {
      outputStarted = true; stopStatusPoll();
      setWaitPhase(job, streamingPhaseFor(String(payload.name || ""))); return;
    }
    if (!prefillSeen && !outputStarted) setWaitPhase(job, "preparing-response");
    usage = { ...usage, ...usageFrom(payload) };
    const choices = Array.isArray(payload.choices) ? payload.choices as Array<{ delta?: Record<string, unknown>; finish_reason?: string | null }> : [];
    if (choices[0]?.finish_reason) finishReason = true;
    const delta = choices[0]?.delta || {};
    const rawContent = typeof delta.content === "string" ? delta.content : "";
    const rawReasoning = typeof (delta.reasoning_content ?? delta.reasoning) === "string" ? String(delta.reasoning_content ?? delta.reasoning) : "";
    // Tags the server left in the text, or a reply it put wholly into reasoning, are sorted here.
    for (const piece of [...thinking.push("reasoning", rawReasoning), ...thinking.push("content", rawContent)]) emitText(piece.kind === "content" ? piece.text : "", piece.kind === "reasoning" ? piece.text : "");
    if (Array.isArray(delta.tool_calls)) for (const part of delta.tool_calls as Array<Record<string, unknown>>) {

      outputStarted = true; stopStatusPoll();
      const index = typeof part.index === "number" ? part.index : calls.size;
      const fn = part.function as Record<string, unknown> | undefined;
      const previous = calls.get(index) || { id: "", type: "function" as const, function: { name: "", arguments: "" } };
      calls.set(index, {
        id: `${previous.id}${typeof part.id === "string" ? part.id : ""}` || `tool-${crypto.randomUUID()}`,
        type: "function",
        function: { name: `${previous.function.name}${typeof fn?.name === "string" ? fn.name : ""}`, arguments: `${previous.function.arguments}${typeof fn?.arguments === "string" ? fn.arguments : ""}` },
      });
      // One phase per delta: clearing and re-setting it would broadcast twice for every argument token.
      setWaitPhase(job, streamingPhaseFor(calls.get(index)?.function.name || ""));
    }
    if (rawContent || rawReasoning || Array.isArray(delta.tool_calls)) inspectRepetition(job, [...calls.values()]);
    const outputEstimate = estimateTokens(content) + estimateTokens(reasoning) + estimateTokens([...calls.values()]);
    const used = Math.max(inputEstimate, usage.inputTokens ?? 0) + Math.max(outputEstimate, usage.outputTokens ?? 0, usage.reasoningTokens ?? 0);
    chargedUsage = { inputTokens: job.lmf ? lmfChargedInput(job.lmf.connection, usage.inputTokens ?? inputEstimate, usage.cachedTokens) : usage.inputTokens ?? inputEstimate, outputTokens: usage.outputTokens ?? outputEstimate };
    if (chargeModelId) setLiveTokenUsage(job.userId, job.message.id, chargeModelId, chargedUsage.inputTokens, chargedUsage.outputTokens);
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
      const { done, value } = await withSlowProgress(() => reader.read(), () => setResponsePhase("waiting-server"), SERVER_RESPONSE_TIMEOUT_MS, outputStarted ? undefined : prefillTimerController.signal); if (done) break;
      buffer += decoder.decode(value, { stream: true }); const records = buffer.split(/\r?\n\r?\n/); buffer = records.pop() || "";
      for (const record of records) { consume(record); if (terminated) break; }
    }
    buffer += decoder.decode();
    if (!terminated && buffer.trim()) consume(buffer);
    for (const piece of thinking.flush()) emitText(piece.kind === "content" ? piece.text : "", piece.kind === "reasoning" ? piece.text : "");
    if (!sawPayload || !terminated && !finishReason) throw new Error("The model response stream ended before completion.");
  } catch (error) {
    if (error instanceof Error && contextOverflowDetails(error) && Boolean(content || reasoning || calls.size))
      Object.assign(error, { neuralPartialOutput: true });
    // A stopped or failed stream still consumed the tokens the server already produced.
    if (chargeModelId && sawPayload) recordTokenUsage(job.userId, chargeModelId, chargedUsage.inputTokens, chargedUsage.outputTokens);
    throw error;
  } finally {
    stopStatusPoll();
    if (chargeModelId) clearLiveTokenUsage(job.userId, job.message.id);
    setWaitPhase(job, undefined);
    await reader.cancel().catch(() => undefined); reader.releaseLock();
  }
  return {
    content, reasoning, calls: [...calls.values()], usage, chargedUsage, compact,
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
  job.message = { ...job.message, toolEvents: [...(job.message.toolEvents || []), event] }; broadcast(job, true); inspectRepetition(job, [], true); return event;
}

function updateToolEvent(job: ChatJob, id: string, patch: Partial<ToolEvent>) {
  job.message = { ...job.message, toolEvents: (job.message.toolEvents || []).map((event) => event.id === id ? { ...event, ...patch } : event) }; broadcast(job, true);
}

function waitForBrowser(job: ChatJob, call: ToolCall) {
  job.controller.signal.throwIfAborted();
  job.status = "waiting"; updateToolEvent(job, call.id, { status: "waiting" });
  return new Promise<unknown>((resolve, reject) => {
    const abort = () => { job.waiting.delete(call.id); reject(new DOMException("Stopped", "AbortError")); };
    job.waiting.set(call.id, (value) => {
      job.controller.signal.removeEventListener("abort", abort); job.waiting.delete(call.id); job.status = "running";
      // Input has been accepted: immediately replace the approval/question UI with the active
      // tool state instead of leaving a stale approval card mounted until execution finishes.
      updateToolEvent(job, call.id, { status: "calling" }); resolve(value);
    });
    job.controller.signal.addEventListener("abort", abort, { once: true });
  });
}

async function run(job: ChatJob) {
  const requestStartedAt = performance.now(); let reasoningSeconds = 0;
  let releaseModel: (() => void) | undefined;
  let releaseRoute: (() => void) | undefined;
  try {
    let config = await readConfig();
    // The agent compacts at its own threshold and never retitles its chats.
    if (job.agent) config = { ...config, harnessSettings: { ...(config.harnessSettings || DEFAULT_HARNESS_SETTINGS), contextMode: "compacting", compactThreshold: job.agent.compactPercent, titleEnabled: false } };
    if (job.input.messages.some((message) => (message.attachments?.length || 0) > config.toolSettings.maxAttachmentsPerMessage)) throw new Error(`A message exceeds the configured ${config.toolSettings.maxAttachmentsPerMessage}-attachment limit.`);
    const { model, selected, base } = runtimeModel(config, job.input, job.userId);
    job.message = { ...job.message, modelName: selected.name };
    job.thinkingTags = effectiveThinkingTags(normalizeThinkingTags(model.thinkingTags)); job.thinkingTagsCross = model.thinkingTagsCross === true;
    // Whether earlier reasoning goes back to the model is the administrator's per-model choice, never the request's.
    job.input = { ...job.input, sendReasoning: (selected.rememberReasoning ?? base.rememberReasoning) === true };
    const chargeModelId=model.isAlias?(config.models.find(item=>!item.isAlias&&(item.id===model.sourceModel||item.sourceModel===model.sourceModel))?.id||model.sourceModel):model.id;
    const configured = connectionForModel(config.connections, model);
    if (!configured) throw new Error("The selected model's connection is unavailable.");
    if (configured.disabled) throw new Error("The selected model's server is disabled.");
    // Backup addresses serve the same models; the request stays on the address chosen here for every round.
    const route = await routeConnection(configured, process.env.OPENAI_API_KEY || "");
    releaseRoute = route.release;
    const connection = route.connection;
    const preset = model.reasoningPresets.find((item) => item.id === job.input.reasoningPresetId && presetVisibleTo(item, job.userId));
    const effort = reasoningEffort(model, preset);
    // Inference parameters: the served model, an alias, the template, then the account's own values where allowed.
    const sampling = resolveSampling({ served: base, alias: selected.isAlias ? selected : undefined, preset, modelId: selected.id, personal: readPersonalSampling(readUserPreferences(job.userId).modelSamplingParams), userEditable: config.samplingUserEditable === true });
    // An account's own rewrite of this model and preset replaces the composed prompt, where the model allows it.
    // This chat's prompt, then the account's prompt for the model, then the server default — where the model allows it.
    const allowed = canPersonalizeSystemPrompt(selected, job.userRole);
    const composedPrompt = resolveSystemPrompt({ model, selectedId: selected.id, preset, allowed, personal: readModelSystemPrompts(readUserPreferences(job.userId))[selected.id], session: readSystemPromptOverrides(job.input.systemPromptOverrides) });
    const systemPrompt = job.agent ? [composedPrompt, job.agent.systemPrompt].filter(Boolean).join("\n\n") : composedPrompt;
    if (model.imageGeneration === true) {
      if (connection.driver !== "openai") throw new Error("Image generation currently requires an OpenAI-compatible connection.");
      const latest = job.input.messages.findLast(message => message.role === "user");
      const userPrompt = latest?.content.trim() || "";
      if (!userPrompt) throw new Error("GPT Image 2 requires a text prompt.");
      if (model.imageInput === false && latest?.attachments?.length) throw new Error("The selected image-generation model does not accept image input.");
      const sourceImages = await Promise.all((latest?.attachments || []).map(async attachment => {
        const stored = await readUpload(attachment.id, job.userId);
        if (!["image/png", "image/jpeg", "image/webp"].includes(stored.metadata.mimeType)) throw new Error("Image editing accepts PNG, JPEG, and WebP attachments only.");
        return { data: await fs.readFile(stored.paths.original), name: stored.metadata.name, mimeType: stored.metadata.mimeType as "image/png" | "image/jpeg" | "image/webp" };
      }));
      assertPlanAccess(job.userId, model.id, model.sourceModel);
      const headers = chatHeaders(connection, process.env.OPENAI_API_KEY || "", job.input.conversationId);
      const prompt = [systemPrompt, userPrompt].filter(Boolean).join("\n\n");
      const generated = await withSlowProgress(() => generateCompatibleImage({
        baseUrl: connection.baseUrl, headers, model: model.sourceModel, prompt,
        maximumBytes: config.toolSettings.imageUploadLimitMb * 1024 * 1024,
        sourceImages,
        signal: job.controller.signal,
      }), () => setWaitPhase(job, "waiting-server"), SERVER_RESPONSE_TIMEOUT_MS);
      job.controller.signal.throwIfAborted();
      const stored = await saveGeneratedImage(generated.image, job.userId,
        `generated-image-${new Date().toISOString().replace(/[:.]/g, "-")}.${generated.extension}`, undefined, generated.mimeType);
      const elapsedSeconds = Math.max(.001, (performance.now() - requestStartedAt) / 1000);
      job.message = {
        ...job.message, attachments: [stored.metadata],
        ...generated.usage,
        contextTokens: (generated.usage.inputTokens || 0) + (generated.usage.outputTokens || 0),
        completionDurationSeconds: elapsedSeconds,
      };
      recordTokenUsage(job.userId, chargeModelId, generated.usage.inputTokens, generated.usage.outputTokens);
      route.record(generated.usage.inputTokens, generated.usage.outputTokens);
      trackPhase(job); stampTotalDuration(job); job.waitPhase = undefined; job.waitProgress = undefined; job.status = "completed";
      await persist(job); broadcast(job, true); finishSubscribers(job); return;
    }
    // The branch's context state (summary, dropped details, context-view edits) shapes what the model receives.
    let contextState: ContextState | undefined;
    try { contextState = loadContextState(job.input.branchId); } catch (error) { console.warn("Context state could not be read:", error); }
    const appliedContext = applyContextState(job.input.messages.map(message => ({ ...message, reasoning: message.reasoning_content })), contextState);
    const contextInput = { ...job.input, messages: appliedContext.entries.map(({ message: { reasoning, ...message } }) => ({ ...message, ...(reasoning ? { reasoning_content: reasoning } : { reasoning_content: undefined }) })) };
    let messages: UpstreamMessage[] = await upstreamMessages(contextInput, job.userId, systemPrompt, config.toolSettings, model);
    if (appliedContext.summary) {
      const systems = messages.findLastIndex(message => message.role === "system") + 1;
      messages = [...messages.slice(0, systems), { role: "system", content: `${HISTORICAL_SUMMARY_PREFIX}${appliedContext.summary}` }, ...messages.slice(systems)];
    }
    const harness = config.harnessSettings || DEFAULT_HARNESS_SETTINGS;
    const harnessContext = { config, model, userId: job.userId, sessionId: job.input.conversationId, signal: job.controller.signal, onPhase: (phase: ChatWaitPhase) => setWaitPhase(job, phase) };
    const toolRequest: ToolRequestContext = {
      userId: job.userId, role: job.userRole, conversationId: job.input.conversationId,
      locale: job.input.clientContext?.language === "ko" || job.input.clientContext?.locale?.toLowerCase().startsWith("ko") ? "ko" : "en",
      clientContext: job.input.clientContext, config, model, signal: job.controller.signal,
      history: () => [...job.conversation.branches.flatMap(branch => branch.messages), job.message].flatMap(message => message.toolEvents || []),
      services: { complete: (modelId, effort, prompt, input, maxTokens) => harnessCompletion(harnessContext, modelId || job.input.modelId, effort, prompt, input, maxTokens) },
      disabledTools: planDisabledToolIds(job.userId),
      managedTools: managedToolsInstalled(),
      ...(job.agent ? { gate: job.agent.gate, agent: { userId: job.userId, mode: job.agent.mode, runId: job.agent.runId, autonomous: job.agent.autonomous } } : {}),
    };
    // Every provider the request switched on and the server allows, fixed for the whole reply.
    const resolvedTools = await resolveTools(toolRequest, job.agent ? agentToolState(job.agent.toolState ?? requestToolState(job.input.tools), job.agent.autonomous) : requestToolState(job.input.tools), job.agent ? [...toolSources(), ...job.agent.sources] : toolSources());
    for (const dropped of resolvedTools.rejected) console.warn(`Tool ${dropped.name} from ${dropped.provider} was not offered: ${dropped.reason}.`);
    const tools = resolvedTools.definitions;
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
    let measuredInput = contextUsage(branchMessages, job.input.sendReasoning === true, "", systemPrompt, 0, contextState).total;
    let compactedBeforeSending = false;
    const messageCountBeforePreparation = messages.length;
    const throughMessageId = messageBeforeLatestUser(job.input.messages);
    messages = await prepareContext(harnessContext, messages, {
      overhead: estimateTokens(tools), measured: measuredInput,
      onCompaction: record => { compactedBeforeSending = true; completeCompaction(job, record); }, onUpdate: record => updateCompaction(job, record),
      persistence: { throughMessageId, save: change => {
        if (!throughMessageId) return;
        try {
          updateContextState(job.input.branchId, state => ({ ...state,
            ...(change.summary !== undefined ? { summary: { text: change.summary, throughMessageId } } : {}),
            ...(change.droppedDetails ? { droppedThroughMessageId: throughMessageId } : {}) }));
        } catch (error) { console.warn("Context state could not be saved:", error); }
      } },
    });
    // A send-time compaction happened before any output, so it opens the transcript.
    if (compactedBeforeSending || messages.length !== messageCountBeforePreparation) { measuredInput = 0; if (compactedBeforeSending) broadcast(job, true); }
    let measuredEstimate = measuredInput > 0 ? estimateTokens(messages) + estimateTokens(tools) : undefined;
    job.message.contextTokens = estimateTokens(messages); broadcast(job, true);
    const sessionId = job.input.conversationId;
    const headers = chatHeaders(connection, envApiKey(connection.driver), sessionId);
    const cloud = !hasModelResidency(connection.driver);
    // Load and prompt progress comes from LM Studio's native API only.
    const progressEnabled = connection.driver === "lmstudio";
    const nativeServer = connection.driver === "lmstudio";
    const serverKey = connectionRoot(connection.baseUrl);
    const sameServer = config.connections.filter(item => connectionEndpoints(item).some(url => connectionRoot(url) === serverKey));
    const limits = sameServer.map(item => item.maxResidentModels || 0).filter(limit => limit > 0);
    const limit = limits.length ? Math.min(...limits) : 0;
    const policy = sameServer.some(item => item.modelWaitPolicy === "serial") ? "serial" : "capacity";
    const managedServer = nativeServer;
    // Hosted providers have nothing to load or unload; only the local servers get a residency adapter.
    const adapter = !cloud && (config.preferences.onDemand || limit > 0 || managedServer) ? createResidencyAdapter(connection, headers, model.contextWindowTokens, phase => setWaitPhase(job, phase), fetch, managedServer && progressEnabled ? progress => setWaitProgress(job, "loading-model", progress) : undefined) : undefined;
    job.lmf = undefined;
    if (connection.driver === "lmf") {
      const stored = storedLmfSession(job.input.conversationId, connection.id, model.sourceModel);
      const sessionId = storedLmfSession(job.input.conversationId, connection.id, model.sourceModel, lmfSessionTtlMs(connection));
      // A session idle past the TTL is deleted on the server and replaced; the chat continues from its full history.
      if (stored && !sessionId) void deleteRemoteLmfSession(connection, headers, stored).catch(() => undefined);
      job.lmf = { connection, model: model.sourceModel, sessionId };
    }
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
      const thresholdTokens = contextWindow ? Math.min(contextWindow * .95, contextWindow * harness.compactThreshold / 100) : 0;
      if (contextWindow && turn > 0 && !skipToolCompaction && usesCompactionThreshold(harness) && projectedInput >= thresholdTokens) {
        // Drop Details first (no model call; the newest tool exchange stays), then the base method if still over.
        if (harness.dropDetailsFirst) messages = dropContextDetails(messages, undefined, recordCompaction);
        if (estimateTokens(messages) + estimateTokens(tools) >= thresholdTokens) {
          if (harness.contextMode === "compacting") {
            releaseModel?.(); releaseModel = undefined;
            if (++compactionResumes > harness.maxCompactionResumes) throw compactionError();
            beginToolCompaction(job);
            try { messages = await compactToolContext(harnessContext, messages, recordCompaction, record => updateCompaction(job, record)); }
            catch (error) { job.controller.signal.throwIfAborted(); throw overflowError({ contextWindow }); }
          } else {
            try { messages = rollContext(messages, Math.floor(thresholdTokens) - estimateTokens(tools), Math.floor(contextWindow * .95) - estimateTokens(tools), recordCompaction); }
            catch { throw overflowError({ contextWindow }); }
          }
        }
        measuredInput = 0; measuredEstimate = undefined;
        projectedInput = estimateTokens(messages) + estimateTokens(tools);
        if (projectedInput > contextWindow * .95) throw overflowError({ promptTokens: projectedInput, contextWindow });
        if (!releaseModel) releaseModel = await acquireModel();
      }
      if (contextWindow && harness.contextMode === "rolling") {
        const rolled = rollingMessages(messages, Math.floor(contextWindow * .95) - estimateTokens(tools));
        if (rolled.length !== messages.length) { measuredInput = 0; measuredEstimate = undefined; }
        messages = rolled; projectedInput = projectedInputTokens(estimateTokens(messages) + estimateTokens(tools), measuredInput, measuredEstimate);
      }
      if (contextWindow && projectedInput > contextWindow * .95) throw overflowError({ promptTokens: projectedInput, contextWindow });
      job.message.contextTokens = projectedInput;
      const remainingTokens = contextWindow ? Math.max(1, contextWindow - projectedInput - 32) : 0;
      assertPlanAccess(job.userId,model.id,model.sourceModel);
      const planOutputLimit=remainingPlanOutputTokens(job.userId,chargeModelId);
      const configuredOutputLimit = harness.maxOutputTokens > 0
        ? (remainingTokens ? Math.min(harness.maxOutputTokens, remainingTokens) : harness.maxOutputTokens)
        : remainingTokens;
      const outputLimit=planOutputLimit===undefined?configuredOutputLimit:configuredOutputLimit?Math.min(configuredOutputLimit,planOutputLimit):planOutputLimit;
      // 0 from the configured side means "no cap"; only an exhausted plan allowance stops the request.
      if(planOutputLimit!==undefined&&planOutputLimit<=0)throw new Error("토큰 출력 한도에 도달했습니다.");
      if (!releaseModel) releaseModel = await acquireModel();
      const body: Record<string, unknown> = { _endpoint: chatEndpoint(connection.driver, connection.baseUrl), _driver: connection.driver, model: model.sourceModel, messages, ...(outputLimit ? { max_tokens: outputLimit } : {}), stream: true, stream_options: { include_usage: true }, ...samplingRequestFields(sampling, connection.driver), ...(effort ? { reasoning_effort: effort } : {}), ...(tools.length ? { tools, tool_choice: "auto" } : {}) };
      let result: Awaited<ReturnType<typeof streamTurn>>;
      try {
        const configuredThreshold = contextWindow ? Math.floor(contextWindow * harness.compactThreshold / 100) : undefined;
        const streamThreshold = configuredThreshold && projectedInput >= configuredThreshold && contextWindow ? Math.floor(contextWindow * .95) : configuredThreshold;
        result = await streamTurn(job, body, headers, nativeServer ? { baseUrl: connection.baseUrl, effort: presetEffortValue(model, preset), sampling } : undefined, progressEnabled, usesCompactionThreshold(harness) ? streamThreshold : undefined, projectedInput, chargeModelId, connection.driver === "lmstudio");
      } catch (error) {
        const overflow = contextOverflowDetails(error);
        if (!overflow) throw error;
        if ((error as Error & { neuralPartialOutput?: boolean }).neuralPartialOutput) throw overflowError(overflow);
        const serverWindow = Math.min(contextWindow || Infinity, overflow.contextWindow || Infinity);
        const failedEstimate = estimateTokens(messages) + estimateTokens(tools);
        if (Number.isFinite(serverWindow)) detectedContextWindow = serverWindow;
        releaseModel?.(); releaseModel = undefined;
        if (usesCompactionThreshold(harness) && Number.isFinite(serverWindow) && ++compactionResumes <= harness.maxCompactionResumes) {
          try {
            // The server's own count can exceed the estimate; aim below its window in estimate units.
            const target = Math.floor(serverWindow * .9 * Math.min(1, failedEstimate / Math.max(1, overflow.promptTokens || failedEstimate))) - estimateTokens(tools);
            if (harness.dropDetailsFirst) messages = dropContextDetails(messages, turn > 0 ? undefined : messages.findLastIndex(message => message.role === "user"), recordCompaction);
            if (estimateTokens(messages) > target) {
              if (harness.contextMode === "rolling") messages = rollContext(messages, target, target, recordCompaction);
              else {
                if (turn > 0) beginToolCompaction(job);
                messages = turn > 0
                  ? await compactToolContext(harnessContext, messages, recordCompaction, record => updateCompaction(job, record))
                  : await prepareContext(harnessContext, messages, { overhead: estimateTokens(tools), measured: overflow.promptTokens, onCompaction: recordCompaction, onUpdate: record => updateCompaction(job, record) });
              }
            }
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
      recordTokenUsage(job.userId,chargeModelId,result.chargedUsage.inputTokens,result.chargedUsage.outputTokens);
      // A routing model names the provider and model that actually answered this turn.
      if (job.lmf?.sessionId && base.routerModel) {
        const routed = await routedModelLabel(job.lmf.connection, headers, job.lmf.sessionId, base).catch(() => undefined);
        if (routed) { job.message = { ...job.message, routedModel: routed }; broadcast(job, true); }
      }
      route.record(result.chargedUsage.inputTokens,result.chargedUsage.outputTokens);
      const serverMeasuredInput = result.usage.inputTokens ? result.usage.inputTokens + (result.usage.outputTokens || 0) : undefined;
      if (result.compact) {
        job.controller.signal.throwIfAborted();
        releaseModel?.(); releaseModel = undefined;
        if (++compactionResumes > harness.maxCompactionResumes) throw compactionError();
        // The partial answer as plain text, followed by a request to go on from where it stopped.
        const partial = result.content.trim() ? [{ role: "assistant", content: result.content }, { role: "user", content: CONTINUE_AFTER_DROP_PROMPT }] : [];
        let handled = false;
        if (harness.dropDetailsFirst) {
          // Drop Details first, without a model call: earlier tool calls, results and reasoning go and the newest
          // finished tool exchange stays. The base method runs only if that is still over the threshold.
          messages = dropContextDetails(messages, undefined, recordCompaction);
          const withPartial = [...messages, ...partial];
          if (!contextThresholdReached(estimateTokens(withPartial) + estimateTokens(tools), contextWindow, harness.compactThreshold)) { messages = withPartial; handled = true; }
        }
        if (!handled && harness.contextMode === "compacting") {
          // Incomplete tool arguments are historical data only; never execute them.
          messages.push({ role: "assistant", content: result.content, reasoning_content: result.reasoning,
            ...(result.calls.length ? { tool_calls: result.calls } : {}) });
          messages = await compactForResume(harnessContext, messages, originalUser, recordCompaction, record => updateCompaction(job, record));
        } else if (!handled) {
          // Rolling: the oldest turns go until the partial answer and the request to continue fit.
          const withPartial = [...messages, ...partial];
          if (!contextWindow) messages = withPartial;
          else try { messages = rollContext(withPartial, Math.floor(contextWindow * harness.compactThreshold / 100) - estimateTokens(tools), Math.floor(contextWindow * .95) - estimateTokens(tools), recordCompaction); }
          catch { throw overflowError({ contextWindow }); }
        }
        measuredInput = 0; measuredEstimate = undefined;
        if (contextThresholdReached(estimateTokens(messages) + estimateTokens(tools), contextWindow, harness.compactThreshold) && harness.contextMode === "compacting") throw compactionError();
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
        trackPhase(job); stampTotalDuration(job); job.waitPhase = undefined; job.waitProgress = undefined; job.status = "completed"; await persist(job); broadcast(job, true); finishSubscribers(job); return;
      }
      messages.push({ role: "assistant", content: result.content, ...(result.reasoning ? { reasoning_content: result.reasoning } : {}), tool_calls: result.calls });
      if (serverMeasuredInput) { measuredInput = serverMeasuredInput; measuredEstimate = estimateTokens(messages) + estimateTokens(tools); }
      closeReasoningStep(job, result.reasoningDurationSeconds);
      pushStep(job, { kind: "tools", ids: result.calls.map(call => call.id) });
      broadcast(job, true);
      const visualToolContent: ModelContentPart[] = [];
      for (const call of result.calls) {
        addToolEvent(job, call); let execution: ToolExecution;
        // Some providers wait for approval or run their own model call (their own model calls). Do not hold
        // this chat's residency lease through either (a serial residency policy would self-deadlock).
        if (resolvedTools.releasesModel(call.function.name)) { releaseModel?.(); releaseModel = undefined; }
        // A single call can be cancelled (by the person, or after the agent's time limit) while the reply goes on.
        const toolAbort: { controller: AbortController; reason?: string } = { controller: new AbortController() };
        (job.toolAborts ??= new Map()).set(call.id, toolAbort);
        const cancelledResult = (): ToolExecution => ({ result: { cancelled: true, error: `The tool call was ${toolAbort.reason || "cancelled"} before it finished. Continue without its result.` } });
        const cancelled = new Promise<ToolExecution>(resolve => toolAbort.controller.signal.addEventListener("abort", () => resolve(cancelledResult()), { once: true }));
        const limit = job.agent?.toolTimeoutMs; let usedMs = 0;
        const limitTimer = limit ? setInterval(() => {
          // Time spent waiting for the person's approval does not count toward the limit.
          if (job.message.toolEvents?.find(event => event.id === call.id)?.status !== "waiting") usedMs += 5000;
          if (usedMs >= limit) cancelChatTool(job, call.id, `stopped after the ${Math.round(limit / 60_000)}-minute time limit`);
        }, 5000) : undefined;
        try {
          execution = await Promise.race([resolvedTools.execute(call.function.name, parseArguments(call.function.arguments), { callId: call.id, rawArguments: call.function.arguments, signal: AbortSignal.any([job.controller.signal, toolAbort.controller.signal]), updateEvent: patch => updateToolEvent(job, call.id, patch), waitForUser: () => waitForBrowser(job, call), setWaitPhase: phase => setWaitPhase(job, phase) }), cancelled]);
          if (toolAbort.controller.signal.aborted) { job.waiting.delete(call.id); updateToolEvent(job, call.id, { status: "error", result: execution.result, completedAt: new Date().toISOString() }); job.status = "running"; }
          else updateToolEvent(job, call.id, { status: "completed", result: execution.result, completedAt: new Date().toISOString() });
        }
        catch (error) {
          if ((error as Error).name === "AbortError" && job.controller.signal.aborted) throw error;
          execution = toolAbort.controller.signal.aborted ? cancelledResult() : { result: { error: error instanceof Error ? error.message : "Tool execution failed." } };
          updateToolEvent(job, call.id, { status: "error", result: execution.result, completedAt: new Date().toISOString() });
        } finally { if (limitTimer) clearInterval(limitTimer); job.toolAborts?.delete(call.id); }
        const textContent = execution.content?.filter((part): part is Extract<ModelContentPart, { type: "text" }> => part.type === "text").map((part) => part.text).join("\n\n");
        messages.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: textContent || JSON.stringify(execution.result) });
        const images = execution.content?.filter((part): part is Exclude<ModelContentPart, { type: "text" }> => part.type === "image_url" || part.type === "image_file") || [];
        if (images.length) visualToolContent.push({ type: "text", text: `${VISUAL_TOOL_CONTENT_PREFIX}${call.function.name} tool:` }, ...images);
      }
      if (visualToolContent.length) messages.push({ role: "user", content: visualToolContent });
    }
    throw new Error("The model repeated tool calls too many times.");
  } catch (error) {
    const stopped = (error as Error).name === "AbortError" || job.controller.signal.aborted;
    trackPhase(job); stampTotalDuration(job);
    job.message = settlePendingTools([job.message])[0];
    job.waitPhase = undefined; job.waitProgress = undefined;
    job.status = stopped ? "stopped" : "error"; job.error = stopped ? undefined : error instanceof Error ? error.message : "Chat generation failed.";
    if (job.message.reasoning) job.message.reasoningDurationSeconds ||= Math.max(1, reasoningSeconds);
    await persist(job).catch(() => undefined); broadcast(job, true); finishSubscribers(job);
  } finally {
    if (!job.agent) releasePlanAdmission(job.userId);
    try { job.agent?.onSettled?.({ status: job.status, content: job.message.content, error: job.error, looped: Boolean(job.agentLoop) }); }
    catch (error) { console.error("Agent settle handler failed", error); }
    releaseModel?.();
    releaseRoute?.();
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

export async function startChatJob(input: StartChatJobInput, userId: string, userRole: UserRole = "user", options: { agent?: AgentJobOptions } = {}) {
  // The agent's own sessions start only through the agent runtime, which supplies their tools and rules.
  if (!options.agent && agentConversation(input.conversationId)) throw new Error("This chat belongs to the agent. Send messages from the agent screen.");
  let existing = jobs.get(input.conversationId);
  if (existing && existing.userId === userId && ["running", "waiting"].includes(existing.status)) return snapshot(existing);
  const conversation = await readConversation(input.conversationId, userId);
  if (!conversation) throw new Error("Conversation not found.");
  if (!conversation.branches.some((branch) => branch.id === input.branchId)) throw new Error("Conversation branch not found.");
  existing = jobs.get(input.conversationId);
  if (existing && existing.userId === userId && ["running", "waiting"].includes(existing.status)) return snapshot(existing);
  const config=await readConfig();const {base}=runtimeModel(config,input,userId);
  // Agent sessions run beside the person's own chats, so they do not take the one-reply-at-a-time slot; limits still apply.
  if (options.agent) assertPlanAccess(userId, base.id, base.sourceModel); else acquirePlanAdmission(userId,base.id,base.sourceModel);
  const job: ChatJob = {
    agent: options.agent, userId, userRole, input, conversation: input.systemPromptOverrides ? { ...conversation, systemPromptOverrides: readSystemPromptOverrides(input.systemPromptOverrides) } : conversation, status: "running", waitPhase: "preparing-response", controller: new AbortController(), subscribers: new Set(), waiting: new Map(),
    repetitionRules: agentRepetitionRules(normalizeRepetitionSettings(config.harnessSettings?.repetitionDetection), Boolean(options.agent)), repetitionCheck: { size: 0, at: 0 },
    startedAt: Date.now(), waitPhaseStartedAt: Date.now(),
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
