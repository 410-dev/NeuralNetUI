import { randomUUID } from "node:crypto";
import { readConfig } from "../config";
import { db } from "../database";
import { readConversation, writeConversation } from "../conversations";
import { getChatJob, startChatJob, stopChatJob, type AgentJobOptions } from "../chat-runtime";
import { connectionForModel } from "../connection-drivers";
import { planAgentAccess } from "../plans";
import { requestApproval } from "../tools/approval";
import { describeMcpApproval } from "../mcp-approval";
import type { ToolGate } from "../tools/types";
import type { Conversation, ModelConfig, StoredMessage, UserRole } from "../types";
import { AGENT_PROVIDER_ID, decideAgentCall, isReadOnlyCall } from "./policy";
import { agentToolSource } from "./tools";
import { defaultAgentInstructions } from "./defaults";
import { isViewingAgent } from "./presence";
import {
  advanceAgentSchedule, agentRunLoad, AGENT_RUN_LIMITS, createAgentProfile, createAgentRun, dueAgentSchedules, failInterruptedAgentRuns, getAgentRun, listAgentItems,
  listAgentProfiles, queuedAgentRuns, readAgentProfile, registerAgentConversation, runningAgentRunCount, saveAgentSettings, setAgentHeartbeat,
  updateAgentRun, DEFAULT_AGENT_SETTINGS, type AgentProfile, type AgentRun, type AgentSettings,
} from "./store";

type Pending = { messages: StoredMessage[]; trigger: boolean; autonomous: boolean };
type RuntimeState = { pending: Map<string, Pending>; locks: Map<string, Promise<unknown>>; changed: Map<string, number>; timer?: ReturnType<typeof setInterval>; started: boolean; ticking?: Promise<void> };
declare global { var neuralAgentRuntime: RuntimeState | undefined; }
const state: RuntimeState = globalThis.neuralAgentRuntime ??= { pending: new Map(), locks: new Map(), changed: new Map(), started: false };

const TICK_MS = 20_000;
/** A reply that keeps repeating itself is regenerated this many times before it is reported as an error. */
export const LOOP_RETRIES = 3;
const toolTimeout = (settings: AgentSettings) => settings.toolTimeoutMinutes > 0 ? settings.toolTimeoutMinutes * 60_000 : undefined;
const id = (prefix: string) => `${prefix}-${randomUUID()}`;
const nowIso = () => new Date().toISOString();
const ko = (settings: AgentSettings) => settings.language !== "en";

/** Runs one change per account at a time, so the agent and its main chat's replies never overwrite each other. */
function serialized<T>(userId: string, task: () => Promise<T>): Promise<T> {
  const previous = state.locks.get(userId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  state.locks.set(userId, next);
  void next.finally(() => { if (state.locks.get(userId) === next) state.locks.delete(userId); }).catch(() => undefined);
  return next;
}

/** A counter the agent screen polls; it changes whenever the main chat, runs or schedules change. */
export function markAgentChanged(userId: string) { state.changed.set(userId, (state.changed.get(userId) ?? 0) + 1); }
export function agentRevision(userId: string) { return state.changed.get(userId) ?? 0; }

function userRole(userId: string): UserRole {
  return ((db.prepare("SELECT role FROM users WHERE id = ?").get(userId) as { role?: UserRole } | undefined)?.role) ?? "user";
}

export function agentAccess(userId: string) { return planAgentAccess(userId); }

/** The account's agent, created with its main chat the first time. */
export async function ensureAgent(userId: string, language?: "ko" | "en"): Promise<AgentProfile> {
  const existing = readAgentProfile(userId);
  if (existing) return existing;
  return serialized(`create:${userId}`, async () => {
    const again = readAgentProfile(userId);
    if (again) return again;
    const stamp = nowIso(), conversationId = id("agent"), branchId = id("branch");
    const conversation: Conversation = { id: conversationId, title: language === "en" ? "Agent" : "에이전트", modelId: "agent", activeBranchId: branchId, createdAt: stamp, updatedAt: stamp, branches: [{ id: branchId, name: "Main", messages: [], createdAt: stamp, updatedAt: stamp }] };
    await writeConversation(conversation, userId);
    return createAgentProfile(userId, conversationId, { ...DEFAULT_AGENT_SETTINGS, instructions: defaultAgentInstructions(language ?? "ko"), ...(language ? { language } : {}) });
  });
}

export function updateAgentSettings(userId: string, patch: Partial<AgentSettings>) {
  const profile = readAgentProfile(userId);
  if (!profile) throw Object.assign(new Error("The agent has not been set up."), { status: 404 });
  // Fields a caller leaves out (undefined) keep their saved values.
  const settings = { ...profile.settings, ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) };
  saveAgentSettings(userId, settings);
  // A shorter interval takes effect now rather than after the old one.
  if ((patch.heartbeatMinutes !== undefined && patch.heartbeatMinutes !== profile.settings.heartbeatMinutes) || (patch.enabled !== undefined && patch.enabled !== profile.settings.enabled)) setAgentHeartbeat(userId, null);
  markAgentChanged(userId);
  return readAgentProfile(userId)!;
}

// ------------------------------------------------------------------ models and prompts

/** The model a session uses: the saved choice if the account may still use it, else the account's default, else the first one it may use. */
async function agentModel(userId: string, preferred: string | undefined, aliasBaseModelId?: string): Promise<{ model: ModelConfig; aliasBaseModelId?: string }> {
  const config = await readConfig();
  const { assertPlanAccess } = await import("../plans");
  const usable = (model: ModelConfig | undefined) => {
    if (!model || model.visible === false || model.imageGeneration) return false;
    if (model.isAlias && model.ownerId && model.ownerId !== userId && model.isPublic !== true) return false;
    const base = model.isAlias ? config.models.find(item => !item.isAlias && (item.id === model.sourceModel || item.sourceModel === model.sourceModel)) : model;
    try { assertPlanAccess(userId, model.id, model.sourceModel); return Boolean(base && connectionForModel(config.connections, base)); } catch { return false; }
  };
  const prefs = (db.prepare("SELECT preferences FROM users WHERE id = ?").get(userId) as { preferences?: string } | undefined)?.preferences;
  let defaultId: string | undefined; try { defaultId = JSON.parse(prefs || "{}").defaultModelId; } catch { /* none */ }
  const model = [preferred, defaultId].map(value => config.models.find(item => item.id === value)).find(usable) ?? config.models.find(usable);
  if (!model) throw new Error("No chat model is available to the agent on this plan.");
  return { model, aliasBaseModelId: model.id === preferred ? aliasBaseModelId : undefined };
}

function clock(settings: AgentSettings) {
  const zone = settings.timeZone || "UTC";
  try { return `${new Date().toLocaleString(ko(settings) ? "ko-KR" : "en-US", { timeZone: zone, dateStyle: "full", timeStyle: "short" })} (${zone})`; }
  catch { return `${nowIso()} (UTC)`; }
}

function mainPrompt(settings: AgentSettings) {
  return [
    "# Personal agent",
    "You are the person's personal assistant in one long-running chat. They give you requests here; you also report here on your own.",
    `Current time: ${clock(settings)}. Reply in ${ko(settings) ? "Korean" : "English"} unless the person writes otherwise.`,
    "- Keep this chat short. Hand anything needing several tool calls, reading long material or waiting to spawn_subagent, then tell the person briefly what you started. Answer simple questions directly.",
    "- Requests for later or repeated work (reminders, watching an inbox, a calendar, a web page, a channel or a topic) become notify_wakeup schedules with complete instructions for the subagent that will run them. Confirm what you scheduled and when.",
    "- Keep the workboard current: to-dos, events from the person's schedule, and memories of durable facts and preferences. Check it before answering about plans or past requests.",
    "- User messages that begin with [Subagent result] or [Agent notice] come from the system, not the person. Summarize what matters for the person in a few lines; do not repeat raw output.",
    "- Never claim to have done something a tool did not confirm.",
  ].join("\n");
}

function subPrompt(settings: AgentSettings, run: AgentRun) {
  return [
    "# Subagent",
    `You are a subagent of the person's personal agent, working alone on one ${run.kind === "heartbeat" ? "periodic check" : run.kind === "schedule" ? "scheduled task" : "task"}: "${run.title}". The person is not watching.`,
    `Current time: ${clock(settings)}. Write anything meant for the person in ${ko(settings) ? "Korean" : "English"}.`,
    "- Do the work with the tools you have. Some tools may need the person's approval; if a call is refused, work around it or say what is blocked.",
    "- Use notify_user only when the person should know something now (a reminder they asked for, an important message, a conflict, a change they track). Do not notify about routine checks that found nothing.",
    "- Record durable findings on the workboard (memories, events, to-dos) and keep recurring work up to date with update_wakeup, e.g. what was last seen, so the next run can compare.",
    "- End with a short plain summary of what you did and found; it goes to the main agent.",
  ].join("\n");
}

function heartbeatInstructions(userId: string, settings: AgentSettings) {
  const soon = Date.now() + 48 * 3600_000;
  const todos = listAgentItems(userId, "todo").filter(item => item.status !== "done").slice(0, 30).map(item => `- ${item.title}${item.startsAt ? ` (${item.startsAt})` : ""}`);
  const events = listAgentItems(userId, "event").filter(item => item.startsAt && Date.parse(item.startsAt) >= Date.now() - 3600_000 && Date.parse(item.startsAt) <= soon).slice(0, 30).map(item => `- ${item.startsAt}: ${item.title}`);
  return [
    "[Periodic check]",
    settings.instructions.trim() ? `Standing instructions from the person:\n${settings.instructions.trim()}` : "No standing instructions. Review the workboard: due or overdue to-dos and events in the next 48 hours, and notify the person only if something needs attention.",
    `Open to-dos:\n${todos.join("\n") || "(none)"}`,
    `Events in the next 48 hours:\n${events.join("\n") || "(none)"}`,
  ].join("\n\n");
}

// ------------------------------------------------------------------ tool rules

function gateFor(userId: string, settings: AgentSettings, autonomous: boolean, onAsk: (tool: string) => void): ToolGate {
  return async ({ providerId, name, sourceName, readOnlyHint, args, ctx }) => {
    if (providerId === AGENT_PROVIDER_ID) return "run";
    if (!autonomous) return "provider";
    const readOnly = isReadOnlyCall(providerId, name, args, readOnlyHint);
    if (decideAgentCall(settings.toolRules, providerId, sourceName, readOnly) === "allow") return "run";
    onAsk(sourceName);
    const approval = await requestApproval(ctx, `agent:${providerId}:${sourceName}`, "always_ask", () => ctx.updateEvent({ arguments: { ...args, _mcpApproval: {
      connectionName: providerId.startsWith("mcp:") ? "MCP" : providerId, toolName: sourceName, policy: "always_ask",
      explanation: describeMcpApproval(sourceName, undefined, args, ctx.locale),
    } } }));
    return approval.approved ? "run" : { result: { executed: false, rejected: true, tool: sourceName } };
  };
}

const toolSource = agentToolSource({
  minIntervalMinutes: userId => planAgentAccess(userId).minIntervalMinutes,
  spawnSubagent: async (userId, input) => {
    const load = agentRunLoad(userId);
    if (load.open >= AGENT_RUN_LIMITS.open) throw new Error(`${load.open} subagents are already queued or running; wait for some to finish.`);
    if (load.recent >= AGENT_RUN_LIMITS.perHour) throw new Error(`The limit of ${AGENT_RUN_LIMITS.perHour} subagents per hour is reached.`);
    const run = createAgentRun(userId, { kind: "task", title: input.title, instructions: input.instructions, report: "always" });
    markAgentChanged(userId); void pumpRuns();
    return { id: run.id, status: run.status };
  },
  notifyUser: async (userId, input) => { await postToMain(userId, { content: input.message.trim().slice(0, 20_000), kind: "notice" }); },
});

// ------------------------------------------------------------------ the main chat

function messagesForJob(messages: StoredMessage[]) {
  return messages.map(message => ({ id: message.id, role: message.role, content: message.content, reasoning_content: message.reasoning, toolEvents: message.toolEvents, attachments: message.attachments?.map(({ id: attachmentId }) => ({ id: attachmentId })) }));
}

function mainBusy(profile: AgentProfile) {
  const job = getChatJob(profile.conversationId, profile.userId);
  return Boolean(job && (job.status === "running" || job.status === "waiting"));
}

/**
 * Adds to the main chat: a notice the person sees, or a context message only the model reads (which also starts a
 * turn so the agent can respond). While a reply is being written, additions wait and follow it.
 */
export async function postToMain(userId: string, input: { content: string; kind: "notice" | "context" | "user"; attachments?: StoredMessage["attachments"] }) {
  if (!input.content.trim() && !input.attachments?.length) return;
  const message: StoredMessage = { id: id("msg"), role: input.kind === "notice" ? "assistant" : "user", content: input.content, createdAt: nowIso(), ...(input.kind === "user" ? {} : { agentKind: input.kind }), ...(input.attachments?.length ? { attachments: input.attachments } : {}) };
  const pending = state.pending.get(userId) ?? { messages: [], trigger: false, autonomous: true };
  pending.messages.push(message);
  if (input.kind !== "notice") pending.trigger = true;
  if (input.kind === "user") pending.autonomous = false;
  state.pending.set(userId, pending);
  if (input.kind === "notice") void notifyDevices(userId, input.content);
  await flushMain(userId);
}

export function flushMain(userId: string): Promise<void> {
  return serialized(userId, async () => {
    const pending = state.pending.get(userId);
    const profile = readAgentProfile(userId);
    if (!pending || !profile || mainBusy(profile)) return;
    state.pending.delete(userId);
    const conversation = await readConversation(profile.conversationId, userId);
    if (!conversation) return;
    const branch = conversation.branches.find(item => item.id === conversation.activeBranchId) ?? conversation.branches[0];
    branch.messages = [...branch.messages, ...pending.messages];
    branch.updatedAt = conversation.updatedAt = nowIso();
    const saved = await writeConversation(conversation, userId);
    markAgentChanged(userId);
    if (pending.trigger) await startMainTurn(profile, saved, pending.autonomous).catch(async error => {
      console.error("Agent turn failed to start", error);
      await postToMain(userId, { content: `${ko(profile.settings) ? "에이전트가 응답을 시작하지 못했습니다" : "The agent could not start a reply"}: ${error instanceof Error ? error.message : String(error)}`, kind: "notice" });
    });
  });
}

async function startMainTurn(profile: AgentProfile, conversation: Conversation, autonomous: boolean, attempt = 0) {
  const { settings, userId } = profile;
  const branch = conversation.branches.find(item => item.id === conversation.activeBranchId) ?? conversation.branches[0];
  const { model, aliasBaseModelId } = await agentModel(userId, settings.modelId, settings.aliasBaseModelId);
  const options: AgentJobOptions = {
    mode: "main", autonomous, systemPrompt: mainPrompt(settings), compactPercent: settings.compactPercent, toolState: settings.toolState, sources: [toolSource], toolTimeoutMs: toolTimeout(settings),
    gate: gateFor(userId, settings, autonomous, tool => void postToMain(userId, { content: ko(settings) ? `도구 사용 승인이 필요합니다: ${tool}. 에이전트 채팅에서 승인해 주세요.` : `Approval needed for ${tool}. Approve it in the agent chat.`, kind: "notice" })),
    onSettled: result => {
      markAgentChanged(userId);
      if (result.looped) {
        // The repeating reply was discarded; write it again, and give up with a notice after the last retry.
        if (attempt < LOOP_RETRIES) { void serialized(userId, async () => { const latest = readAgentProfile(userId) ?? profile; const fresh = await readConversation(latest.conversationId, userId); if (fresh) await startMainTurn(latest, fresh, autonomous, attempt + 1); }).catch(error => console.error("Agent retry failed", error)); return; }
        void postToMain(userId, { content: ko(settings) ? `에이전트의 응답이 같은 내용을 계속 반복해서 ${LOOP_RETRIES}번 다시 생성했지만 해결되지 않았습니다. 요청을 바꾸거나 다른 모델로 다시 시도해 주세요.` : `The agent's reply kept repeating itself; it was regenerated ${LOOP_RETRIES} times without success. Rephrase the request or try another model.`, kind: "notice" });
        return;
      }
      if (result.status === "completed" && result.content.trim()) void notifyDevices(userId, result.content);
      setTimeout(() => void flushMain(userId), 50);
    },
  };
  await startChatJob({
    conversationId: conversation.id, branchId: branch.id, assistantMessageId: id("msg"), modelId: model.id, aliasBaseModelId,
    reasoningPresetId: settings.reasoningPresetId, tools: settings.toolState, messages: messagesForJob(branch.messages),
    clientContext: { timeZone: settings.timeZone, locale: settings.locale, language: settings.language },
  }, userId, userRole(userId), { agent: options });
  markAgentChanged(userId);
}

/** The person's message from the agent screen; it is answered as soon as the agent is free. */
export async function sendAgentMessage(userId: string, input: { content: string; attachments?: StoredMessage["attachments"]; settings?: Partial<AgentSettings> }) {
  const access = planAgentAccess(userId);
  if (!access.enabled) throw Object.assign(new Error("The agent is not available on this plan."), { status: 403 });
  const profile = await ensureAgent(userId, input.settings?.language);
  if (input.settings) updateAgentSettings(userId, input.settings);
  const busy = mainBusy(profile);
  await postToMain(userId, { content: input.content, kind: "user", attachments: input.attachments });
  return { conversationId: profile.conversationId, queued: busy };
}

export function stopAgentMain(userId: string) {
  const profile = readAgentProfile(userId);
  const job = profile && getChatJob(profile.conversationId, userId);
  if (job) stopChatJob(job);
}

// ------------------------------------------------------------------ subagent runs

async function startRun(run: AgentRun) {
  const profile = readAgentProfile(run.userId);
  if (!profile) { updateAgentRun(run.id, { status: "failed", error: "No agent profile.", finishedAt: nowIso() }); return; }
  const { settings, userId } = profile;
  const stamp = nowIso(), conversationId = id("agent-run"), branchId = id("branch");
  const instructions = run.kind === "heartbeat" ? heartbeatInstructions(userId, settings) : run.instructions;
  const first: StoredMessage = { id: id("msg"), role: "user", content: instructions, createdAt: stamp };
  registerAgentConversation(userId, conversationId, "sub", run.id);
  await writeConversation({ id: conversationId, title: run.title, modelId: "agent", activeBranchId: branchId, createdAt: stamp, updatedAt: stamp, branches: [{ id: branchId, name: "Main", messages: [first], createdAt: stamp, updatedAt: stamp }] }, userId);
  updateAgentRun(run.id, { status: "running", startedAt: stamp, conversationId });
  markAgentChanged(userId);
  await startRunJob(run, profile, conversationId, branchId, first, 0);
}

/** One attempt at a run's reply; a reply discarded for repeating itself is attempted again. */
async function startRunJob(run: AgentRun, profile: AgentProfile, conversationId: string, branchId: string, first: StoredMessage, attempt: number) {
  const { settings, userId } = profile;
  const { model, aliasBaseModelId } = await agentModel(userId, settings.subagentModelId || settings.modelId, settings.subagentModelId ? undefined : settings.aliasBaseModelId);
  const options: AgentJobOptions = {
    mode: "sub", runId: run.id, autonomous: true, systemPrompt: subPrompt(settings, run), compactPercent: settings.compactPercent, toolState: settings.toolState, sources: [toolSource], toolTimeoutMs: toolTimeout(settings),
    gate: gateFor(userId, settings, true, tool => {
      updateAgentRun(run.id, { status: "waiting" }); markAgentChanged(userId);
      void postToMain(userId, { content: ko(settings) ? `작업 "${run.title}"이(가) 도구 사용 승인을 기다립니다: ${tool}. 서브에이전트 기록에서 승인하거나 거절해 주세요.` : `Task "${run.title}" is waiting for approval to use ${tool}. Approve or reject it in the subagent history.`, kind: "notice" });
    }),
    onSettled: result => {
      if (result.looped && attempt < LOOP_RETRIES) { markAgentChanged(userId); void startRunJob(run, readAgentProfile(userId) ?? profile, conversationId, branchId, first, attempt + 1).catch(error => void finishRun(run, { status: "error", content: "", error: error instanceof Error ? error.message : String(error) })); return; }
      void finishRun(run, result.looped ? { status: "error", content: "", error: ko(settings) ? `출력이 같은 내용을 계속 반복해서 ${LOOP_RETRIES}번 다시 생성했지만 해결되지 않았습니다.` : `The reply kept repeating itself; ${LOOP_RETRIES} regenerations did not help.` } : result);
    },
  };
  // A decision on a waiting call resumes the run.
  const original = options.gate!;
  options.gate = async call => { const decision = await original(call); if (getAgentRun(userId, run.id)?.status === "waiting") { updateAgentRun(run.id, { status: "running" }); markAgentChanged(userId); } return decision; };
  await startChatJob({
    conversationId, branchId, assistantMessageId: id("msg"), modelId: model.id, aliasBaseModelId, tools: settings.toolState, messages: messagesForJob([first]),
    clientContext: { timeZone: settings.timeZone, locale: settings.locale, language: settings.language },
  }, userId, userRole(userId), { agent: options });
}

async function finishRun(run: AgentRun, result: { status: string; content: string; error?: string }) {
  const status = result.status === "completed" ? "completed" : result.status === "stopped" ? "cancelled" : "failed";
  updateAgentRun(run.id, { status, result: result.content.slice(0, 40_000) || undefined, error: result.error, finishedAt: nowIso() });
  markAgentChanged(run.userId);
  const profile = readAgentProfile(run.userId);
  // Work the person asked for always comes back to the main agent; automatic runs speak through notify_user.
  if (profile && run.report === "always" && status !== "cancelled") {
    const label = ko(profile.settings) ? (status === "completed" ? "완료" : "실패") : status;
    await postToMain(run.userId, { content: `[Subagent result · ${run.title} · ${label}]\n${(status === "completed" ? result.content : result.error || result.content || "").slice(0, 12_000)}`, kind: "context" });
  }
  void pumpRuns();
}

export function cancelAgentRun(userId: string, runId: string) {
  const run = getAgentRun(userId, runId);
  if (!run) throw Object.assign(new Error("Run not found."), { status: 404 });
  if (run.status === "queued") { updateAgentRun(run.id, { status: "cancelled", finishedAt: nowIso() }); markAgentChanged(userId); return; }
  const job = run.conversationId ? getChatJob(run.conversationId, userId) : undefined;
  if (job) stopChatJob(job);
}

async function concurrencyLimit(userId: string) {
  const profile = readAgentProfile(userId);
  if (!profile) return 1;
  try {
    const config = await readConfig();
    const { model } = await agentModel(userId, profile.settings.subagentModelId || profile.settings.modelId);
    const base = model.isAlias ? config.models.find(item => !item.isAlias && (item.id === model.sourceModel || item.sourceModel === model.sourceModel)) : model;
    const limit = base ? connectionForModel(config.connections, base)?.maxConcurrentRequests ?? 1 : 1;
    return limit === 0 ? Infinity : Math.max(1, limit);
  } catch { return 1; }
}

/** Starts queued runs while each account's subagent server has room: in parallel only up to its concurrent request limit. */
export async function pumpRuns() {
  const byUser = new Map<string, AgentRun[]>();
  for (const run of queuedAgentRuns()) byUser.set(run.userId, [...(byUser.get(run.userId) ?? []), run]);
  for (const [userId, runs] of byUser) {
    if (!planAgentAccess(userId).enabled) continue;
    let room = (await concurrencyLimit(userId)) - runningAgentRunCount(userId);
    for (const run of runs) {
      if (room <= 0) break;
      room--;
      await startRun(run).catch(error => {
        updateAgentRun(run.id, { status: "failed", error: error instanceof Error ? error.message : String(error), finishedAt: nowIso() });
        markAgentChanged(userId);
      });
    }
  }
}

// ------------------------------------------------------------------ scheduler

async function tick() {
  const at = Date.now();
  for (const profile of listAgentProfiles()) {
    const access = planAgentAccess(profile.userId);
    if (!access.enabled || !profile.settings.enabled) continue;
    const interval = Math.max(profile.settings.heartbeatMinutes, access.minIntervalMinutes) * 60_000;
    if (!profile.nextHeartbeatAt) { setAgentHeartbeat(profile.userId, new Date(at + interval).toISOString()); markAgentChanged(profile.userId); continue; }
    if (Date.parse(profile.nextHeartbeatAt) <= at) {
      createAgentRun(profile.userId, { kind: "heartbeat", title: ko(profile.settings) ? "주기 점검" : "Periodic check", instructions: "(periodic check)" });
      setAgentHeartbeat(profile.userId, new Date(at + interval).toISOString(), new Date(at).toISOString());
      markAgentChanged(profile.userId);
    }
  }
  for (const due of dueAgentSchedules(new Date(at))) {
    const profile = readAgentProfile(due.userId);
    advanceAgentSchedule(due.id, at);
    if (!profile || !planAgentAccess(due.userId).enabled || !profile.settings.enabled) continue;
    if (agentRunLoad(due.userId).recent >= AGENT_RUN_LIMITS.perHour) continue;
    createAgentRun(due.userId, { kind: "schedule", title: due.title, instructions: due.instructions, scheduleId: due.id });
    markAgentChanged(due.userId);
  }
  await pumpRuns();
  for (const userId of state.pending.keys()) await flushMain(userId);
}

/** Starts the agent clock once per server process; runs interrupted by a restart are marked failed. */
export function ensureAgentScheduler() {
  if (state.started) return;
  state.started = true;
  try { failInterruptedAgentRuns("The server restarted while this run was in progress."); } catch (error) { console.error("Agent startup cleanup failed", error); }
  const run = () => { state.ticking ??= tick().catch(error => console.error("Agent tick failed", error)).finally(() => { state.ticking = undefined; }); };
  state.timer = setInterval(run, TICK_MS); state.timer.unref?.();
  setTimeout(run, 2_000).unref?.();
}

// ------------------------------------------------------------------ notifications

/** Sends a push notification to every registered device, unless the person is looking at the agent somewhere. */
async function notifyDevices(userId: string, text: string) {
  if (isViewingAgent(userId)) return;
  try { const { pushToUser } = await import("./push"); await pushToUser(userId, { title: "Agent", body: text.replace(/\s+/g, " ").trim().slice(0, 180) }); }
  catch (error) { console.warn("Agent push failed", error instanceof Error ? error.message : error); }
}
