import { randomUUID } from "node:crypto";
import { db } from "../database.ts";
import type { ToolState } from "../tools/state.ts";
import type { AgentToolRules } from "./policy.ts";

/** Everything the person sets in the agent's own settings dialog, plus what the agent screen last used. */
export type AgentSettings = {
  /** Automatic runs (the periodic check and scheduled work) are on. Chatting works either way. */
  enabled: boolean;
  /** The main chat's model, from the agent screen's model picker. */
  modelId?: string;
  aliasBaseModelId?: string;
  reasoningPresetId?: string;
  /** Model for subagents and automatic runs; missing means the main chat's model. */
  subagentModelId?: string;
  /** Minutes between periodic checks. Never shorter than the plan allows. */
  heartbeatMinutes: number;
  /** Standing instructions every periodic check follows. */
  instructions: string;
  /** The main chat's system prompt; missing means the default for the agent's language (defaultAgentMainPrompt). */
  mainPrompt?: string;
  /** The main chat and every subagent are compacted past this share of the model's context window. */
  compactPercent: number;
  /** A tool call running longer than this is cancelled (approval waits excluded); 0 means no limit. */
  toolTimeoutMinutes: number;
  /** Tools the agent may use, as switched on in the agent screen's tool menu. */
  toolState?: ToolState;
  /** What automatic runs may do without asking, per tool provider. */
  toolRules: AgentToolRules;
  timeZone?: string;
  locale?: string;
  language?: "ko" | "en";
};

export const DEFAULT_AGENT_SETTINGS: AgentSettings = { enabled: true, heartbeatMinutes: 60, instructions: "", compactPercent: 50, toolTimeoutMinutes: 10, toolRules: {} };

export type AgentProfile = { userId: string; conversationId: string; settings: AgentSettings; nextHeartbeatAt?: string; lastHeartbeatAt?: string };
export type AgentItemKind = "todo" | "event" | "memory";
export type AgentItem = { id: string; kind: AgentItemKind; title: string; body?: string; status?: string; startsAt?: string; endsAt?: string; createdAt: string; updatedAt: string };
export type AgentSchedule = { id: string; kind: "once" | "recurring"; title: string; instructions: string; nextRunAt?: string; intervalMinutes?: number; enabled: boolean; lastRunAt?: string; createdAt: string; updatedAt: string };
export type AgentRunStatus = "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled";
export type AgentRun = { id: string; userId: string; conversationId?: string; kind: "task" | "heartbeat" | "schedule"; scheduleId?: string; title: string; instructions: string; report: "always" | "if_needed"; status: AgentRunStatus; result?: string; error?: string; createdAt: string; startedAt?: string; finishedAt?: string;
  /** The model that did the work, and the tokens its requests used (input includes cache reads), once the run ends. */
  modelName?: string; inputTokens?: number; outputTokens?: number };

const now = () => new Date().toISOString();
const optional = <T>(value: T | null | undefined) => value ?? undefined;

export function normalizeAgentSettings(value: unknown): AgentSettings {
  const raw = value && typeof value === "object" ? value as Partial<AgentSettings> : {};
  const text = (input: unknown, max: number) => typeof input === "string" ? input.slice(0, max) : undefined;
  const bounded = (input: unknown, min: number, max: number, fallback: number) => Number.isFinite(Number(input)) ? Math.min(max, Math.max(min, Math.round(Number(input)))) : fallback;
  const rules: AgentToolRules = {};
  for (const [provider, rule] of Object.entries(raw.toolRules && typeof raw.toolRules === "object" ? raw.toolRules : {})) {
    if (!rule || typeof rule !== "object") continue;
    const decision = (input: unknown) => input === "allow" || input === "ask" ? input : undefined;
    const tools = Object.fromEntries(Object.entries(rule.tools && typeof rule.tools === "object" ? rule.tools : {}).map(([name, value]) => [name.slice(0, 200), decision(value)]).filter(([, value]) => value)) as Record<string, "allow" | "ask">;
    rules[provider.slice(0, 200)] = { ...(decision(rule.read) ? { read: decision(rule.read) } : {}), ...(decision(rule.write) ? { write: decision(rule.write) } : {}), ...(Object.keys(tools).length ? { tools } : {}) };
  }
  return {
    enabled: raw.enabled !== false,
    modelId: text(raw.modelId, 500), aliasBaseModelId: text(raw.aliasBaseModelId, 500), reasoningPresetId: text(raw.reasoningPresetId, 500),
    subagentModelId: text(raw.subagentModelId, 500) || undefined,
    heartbeatMinutes: bounded(raw.heartbeatMinutes, 1, 10080, DEFAULT_AGENT_SETTINGS.heartbeatMinutes),
    instructions: text(raw.instructions, 20_000) ?? "",
    mainPrompt: text(raw.mainPrompt, 50_000)?.trim() || undefined,
    compactPercent: bounded(raw.compactPercent, 10, 95, DEFAULT_AGENT_SETTINGS.compactPercent),
    toolTimeoutMinutes: bounded(raw.toolTimeoutMinutes, 0, 1440, DEFAULT_AGENT_SETTINGS.toolTimeoutMinutes),
    ...(raw.toolState && typeof raw.toolState === "object" ? { toolState: raw.toolState } : {}),
    toolRules: rules,
    timeZone: text(raw.timeZone, 100), locale: text(raw.locale, 50), language: raw.language === "ko" || raw.language === "en" ? raw.language : undefined,
  };
}

type ProfileRow = { user_id: string; conversation_id: string; settings: string; next_heartbeat_at: string | null; last_heartbeat_at: string | null };
const profile = (row: ProfileRow): AgentProfile => ({ userId: row.user_id, conversationId: row.conversation_id, settings: normalizeAgentSettings(JSON.parse(row.settings)), nextHeartbeatAt: optional(row.next_heartbeat_at), lastHeartbeatAt: optional(row.last_heartbeat_at) });

export function readAgentProfile(userId: string): AgentProfile | undefined {
  const row = db.prepare("SELECT * FROM agent_profiles WHERE user_id = ?").get(userId) as ProfileRow | undefined;
  return row ? profile(row) : undefined;
}

export function listAgentProfiles(): AgentProfile[] {
  return (db.prepare("SELECT * FROM agent_profiles").all() as ProfileRow[]).map(profile);
}

export function createAgentProfile(userId: string, conversationId: string, settings: AgentSettings) {
  const stamp = now();
  db.transaction(() => {
    db.prepare("INSERT INTO agent_profiles(user_id, conversation_id, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(userId, conversationId, JSON.stringify(settings), stamp, stamp);
    registerAgentConversation(userId, conversationId, "main");
  })();
  return readAgentProfile(userId)!;
}

export function saveAgentSettings(userId: string, settings: AgentSettings) {
  db.prepare("UPDATE agent_profiles SET settings = ?, updated_at = ? WHERE user_id = ?").run(JSON.stringify(normalizeAgentSettings(settings)), now(), userId);
}

export function setAgentHeartbeat(userId: string, next: string | null, last?: string) {
  db.prepare(`UPDATE agent_profiles SET next_heartbeat_at = ?${last ? ", last_heartbeat_at = ?" : ""}, updated_at = ? WHERE user_id = ?`).run(...(last ? [next, last, now(), userId] : [next, now(), userId]));
}

export function registerAgentConversation(userId: string, conversationId: string, kind: "main" | "sub", runId?: string) {
  db.prepare("INSERT OR REPLACE INTO agent_conversations(conversation_id, user_id, kind, run_id) VALUES (?, ?, ?, ?)").run(conversationId, userId, kind, runId ?? null);
}

export function agentConversation(conversationId: string): { userId: string; kind: "main" | "sub"; runId?: string } | undefined {
  const row = db.prepare("SELECT user_id, kind, run_id FROM agent_conversations WHERE conversation_id = ?").get(conversationId) as { user_id: string; kind: "main" | "sub"; run_id: string | null } | undefined;
  return row ? { userId: row.user_id, kind: row.kind, runId: optional(row.run_id) } : undefined;
}

// ---------------------------------------------------------------- workboard items
type ItemRow = { id: string; kind: AgentItemKind; title: string; body: string | null; status: string | null; starts_at: string | null; ends_at: string | null; created_at: string; updated_at: string };
const item = (row: ItemRow): AgentItem => ({ id: row.id, kind: row.kind, title: row.title, body: optional(row.body), status: optional(row.status), startsAt: optional(row.starts_at), endsAt: optional(row.ends_at), createdAt: row.created_at, updatedAt: row.updated_at });

export function listAgentItems(userId: string, kind?: AgentItemKind): AgentItem[] {
  const rows = kind
    ? db.prepare("SELECT * FROM agent_items WHERE user_id = ? AND kind = ? ORDER BY COALESCE(starts_at, updated_at) DESC LIMIT 500").all(userId, kind)
    : db.prepare("SELECT * FROM agent_items WHERE user_id = ? ORDER BY kind, COALESCE(starts_at, updated_at) DESC LIMIT 1500").all(userId);
  return (rows as ItemRow[]).map(item);
}

export type AgentItemInput = { kind?: AgentItemKind; title?: string; body?: string | null; status?: string | null; startsAt?: string | null; endsAt?: string | null };
const iso = (value: unknown) => { if (value === null) return null; if (typeof value !== "string" || !value.trim()) return undefined; const time = Date.parse(value); if (!Number.isFinite(time)) throw Object.assign(new Error(`Invalid time: ${value}`), { status: 400 }); return new Date(time).toISOString(); };

export function addAgentItem(userId: string, input: AgentItemInput): AgentItem {
  const kind = input.kind;
  if (kind !== "todo" && kind !== "event" && kind !== "memory") throw Object.assign(new Error("kind must be todo, event or memory."), { status: 400 });
  const title = String(input.title || "").trim().slice(0, 300);
  if (!title) throw Object.assign(new Error("A title is required."), { status: 400 });
  if ((db.prepare("SELECT COUNT(*) AS n FROM agent_items WHERE user_id = ?").get(userId) as { n: number }).n >= 2000) throw Object.assign(new Error("The workboard is full (2000 items). Remove some first."), { status: 409 });
  const id = randomUUID(), stamp = now();
  db.prepare("INSERT INTO agent_items(id, user_id, kind, title, body, status, starts_at, ends_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, userId, kind, title, input.body?.slice(0, 20_000) || null, input.status?.slice(0, 40) || (kind === "todo" ? "open" : null), iso(input.startsAt) ?? null, iso(input.endsAt) ?? null, stamp, stamp);
  return getAgentItem(userId, id)!;
}

export function getAgentItem(userId: string, id: string) {
  const row = db.prepare("SELECT * FROM agent_items WHERE id = ? AND user_id = ?").get(id, userId) as ItemRow | undefined;
  return row ? item(row) : undefined;
}

export function updateAgentItem(userId: string, id: string, input: AgentItemInput): AgentItem {
  const current = getAgentItem(userId, id);
  if (!current) throw Object.assign(new Error("Workboard item not found."), { status: 404 });
  const title = input.title !== undefined ? String(input.title).trim().slice(0, 300) : current.title;
  if (!title) throw Object.assign(new Error("A title is required."), { status: 400 });
  const pick = <T>(value: T | null | undefined, fallback: T | undefined) => value === undefined ? fallback ?? null : value;
  const startsAt = iso(input.startsAt), endsAt = iso(input.endsAt);
  db.prepare("UPDATE agent_items SET title = ?, body = ?, status = ?, starts_at = ?, ends_at = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(title, pick(input.body?.slice(0, 20_000), current.body), pick(input.status?.slice(0, 40), current.status), pick(startsAt, current.startsAt), pick(endsAt, current.endsAt), now(), id, userId);
  return getAgentItem(userId, id)!;
}

export function removeAgentItem(userId: string, id: string) {
  return db.prepare("DELETE FROM agent_items WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}

// ---------------------------------------------------------------- schedules (notify-wakeup)
type ScheduleRow = { id: string; kind: "once" | "recurring"; title: string; instructions: string; next_run_at: string | null; interval_minutes: number | null; enabled: number; last_run_at: string | null; created_at: string; updated_at: string };
const schedule = (row: ScheduleRow): AgentSchedule => ({ id: row.id, kind: row.kind, title: row.title, instructions: row.instructions, nextRunAt: optional(row.next_run_at), intervalMinutes: optional(row.interval_minutes), enabled: row.enabled === 1, lastRunAt: optional(row.last_run_at), createdAt: row.created_at, updatedAt: row.updated_at });

export function listAgentSchedules(userId: string): AgentSchedule[] {
  return (db.prepare("SELECT * FROM agent_schedules WHERE user_id = ? ORDER BY enabled DESC, next_run_at IS NULL, next_run_at").all(userId) as ScheduleRow[]).map(schedule);
}

export function getAgentSchedule(userId: string, id: string) {
  const row = db.prepare("SELECT * FROM agent_schedules WHERE id = ? AND user_id = ?").get(id, userId) as ScheduleRow | undefined;
  return row ? schedule(row) : undefined;
}

export type AgentScheduleInput = { title?: string; instructions?: string; at?: string; inMinutes?: number; everyMinutes?: number; enabled?: boolean };

/** A one-time wakeup at `at` (or `inMinutes` from now), or a recurring one every `everyMinutes`, first at `at` or one interval from now. */
export function addAgentSchedule(userId: string, input: AgentScheduleInput, minIntervalMinutes: number, at = Date.now()): AgentSchedule {
  const title = String(input.title || "").trim().slice(0, 200), instructions = String(input.instructions || "").trim().slice(0, 20_000);
  if (!title || !instructions) throw Object.assign(new Error("A title and instructions are required."), { status: 400 });
  if ((db.prepare("SELECT COUNT(*) AS n FROM agent_schedules WHERE user_id = ? AND enabled = 1").get(userId) as { n: number }).n >= 200) throw Object.assign(new Error("Too many active schedules (200)."), { status: 409 });
  const every = input.everyMinutes !== undefined ? Math.round(Number(input.everyMinutes)) : undefined;
  if (every !== undefined && (!Number.isFinite(every) || every < minIntervalMinutes)) throw Object.assign(new Error(`Recurring work must be at least ${minIntervalMinutes} minutes apart.`), { status: 400 });
  const first = input.at ? Date.parse(input.at) : input.inMinutes !== undefined ? at + Math.max(0, Number(input.inMinutes)) * 60_000 : every ? at + every * 60_000 : NaN;
  if (!Number.isFinite(first)) throw Object.assign(new Error("Give a time (at), a delay (in_minutes) or an interval (every_minutes)."), { status: 400 });
  const id = randomUUID(), stamp = now();
  db.prepare("INSERT INTO agent_schedules(id, user_id, kind, title, instructions, next_run_at, interval_minutes, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)")
    .run(id, userId, every ? "recurring" : "once", title, instructions, new Date(Math.max(first, at)).toISOString(), every ?? null, stamp, stamp);
  return getAgentSchedule(userId, id)!;
}

export function updateAgentSchedule(userId: string, id: string, input: AgentScheduleInput, minIntervalMinutes: number): AgentSchedule {
  const current = getAgentSchedule(userId, id);
  if (!current) throw Object.assign(new Error("Schedule not found."), { status: 404 });
  const every = input.everyMinutes !== undefined ? Math.round(Number(input.everyMinutes)) : current.intervalMinutes;
  if (current.kind === "recurring" && (!every || every < minIntervalMinutes)) throw Object.assign(new Error(`Recurring work must be at least ${minIntervalMinutes} minutes apart.`), { status: 400 });
  const next = input.at ? new Date(Date.parse(input.at)).toISOString() : current.nextRunAt;
  if (input.at && !Number.isFinite(Date.parse(input.at))) throw Object.assign(new Error(`Invalid time: ${input.at}`), { status: 400 });
  db.prepare("UPDATE agent_schedules SET title = ?, instructions = ?, next_run_at = ?, interval_minutes = ?, enabled = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(input.title?.trim().slice(0, 200) || current.title, input.instructions?.trim().slice(0, 20_000) || current.instructions, next ?? null, current.kind === "recurring" ? every : null, input.enabled === undefined ? Number(current.enabled) : Number(input.enabled), now(), id, userId);
  return getAgentSchedule(userId, id)!;
}

export function removeAgentSchedule(userId: string, id: string) {
  return db.prepare("DELETE FROM agent_schedules WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}

/** Schedules due now, across every account. */
export function dueAgentSchedules(at = new Date()): Array<AgentSchedule & { userId: string }> {
  return (db.prepare("SELECT * FROM agent_schedules WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at LIMIT 200").all(at.toISOString()) as Array<ScheduleRow & { user_id: string }>).map(row => ({ ...schedule(row), userId: row.user_id }));
}

/** Moves a schedule past this run: a one-time wakeup turns off, recurring work moves to its next slot after now. */
export function advanceAgentSchedule(id: string, at = Date.now()) {
  const row = db.prepare("SELECT * FROM agent_schedules WHERE id = ?").get(id) as ScheduleRow | undefined;
  if (!row) return;
  if (row.kind === "once" || !row.interval_minutes) { db.prepare("UPDATE agent_schedules SET enabled = 0, last_run_at = ?, next_run_at = NULL, updated_at = ? WHERE id = ?").run(new Date(at).toISOString(), now(), id); return; }
  const interval = row.interval_minutes * 60_000;
  let next = Date.parse(row.next_run_at || new Date(at).toISOString());
  while (next <= at) next += interval;
  db.prepare("UPDATE agent_schedules SET next_run_at = ?, last_run_at = ?, updated_at = ? WHERE id = ?").run(new Date(next).toISOString(), new Date(at).toISOString(), now(), id);
}

// ---------------------------------------------------------------- subagent runs
type RunRow = { id: string; user_id: string; conversation_id: string | null; kind: AgentRun["kind"]; schedule_id: string | null; title: string; instructions: string; report: AgentRun["report"]; status: AgentRunStatus; result: string | null; error: string | null; created_at: string; started_at: string | null; finished_at: string | null; model_name?: string | null; input_tokens?: number | null; output_tokens?: number | null };
const run = (row: RunRow): AgentRun => ({ id: row.id, userId: row.user_id, conversationId: optional(row.conversation_id), kind: row.kind, scheduleId: optional(row.schedule_id), title: row.title, instructions: row.instructions, report: row.report, status: row.status, result: optional(row.result), error: optional(row.error), createdAt: row.created_at, startedAt: optional(row.started_at), finishedAt: optional(row.finished_at), modelName: optional(row.model_name ?? null), inputTokens: optional(row.input_tokens ?? null), outputTokens: optional(row.output_tokens ?? null) });

/** Runs an account started within the last hour, and runs not yet finished: limits against a model that keeps spawning work. */
export function agentRunLoad(userId: string, at = Date.now()) {
  const recent = (db.prepare("SELECT COUNT(*) AS n FROM agent_runs WHERE user_id = ? AND created_at >= ?").get(userId, new Date(at - 3600_000).toISOString()) as { n: number }).n;
  const open = (db.prepare("SELECT COUNT(*) AS n FROM agent_runs WHERE user_id = ? AND status IN ('queued', 'running', 'waiting')").get(userId) as { n: number }).n;
  return { recent, open };
}
export const AGENT_RUN_LIMITS = { perHour: 60, open: 20 };

export function createAgentRun(userId: string, input: { kind: AgentRun["kind"]; title: string; instructions: string; report?: AgentRun["report"]; scheduleId?: string }): AgentRun {
  const id = randomUUID();
  db.prepare("INSERT INTO agent_runs(id, user_id, kind, schedule_id, title, instructions, report, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)")
    .run(id, userId, input.kind, input.scheduleId ?? null, input.title.trim().slice(0, 200) || "Task", input.instructions.slice(0, 40_000), input.report ?? "if_needed", now());
  return getAgentRun(userId, id)!;
}

/**
 * The chat of the latest earlier run of the same periodic series (the periodic check, or one recurring schedule) whose
 * LMFuseFramework session was kept open; a closed session leaves no record, so its chat is not offered.
 */
export function keptSeriesConversation(userId: string, run: Pick<AgentRun, "id" | "kind" | "scheduleId">): string | undefined {
  if (run.kind !== "heartbeat" && !(run.kind === "schedule" && run.scheduleId)) return undefined;
  const row = db.prepare(`SELECT r.conversation_id AS conversationId FROM agent_runs r
    WHERE r.user_id = ? AND r.id <> ? AND r.conversation_id IS NOT NULL AND r.status IN ('completed', 'failed', 'cancelled')
      AND ${run.kind === "heartbeat" ? "r.kind = 'heartbeat'" : "r.kind = 'schedule' AND r.schedule_id = ?"}
      AND EXISTS (SELECT 1 FROM lmf_sessions s WHERE s.conversation_id = r.conversation_id)
    ORDER BY r.created_at DESC LIMIT 1`).get(...(run.kind === "heartbeat" ? [userId, run.id] : [userId, run.id, run.scheduleId])) as { conversationId: string } | undefined;
  return row?.conversationId;
}

/** Chats of a recurring schedule's runs whose LMFuseFramework session is still open. */
export function scheduleConversationsWithSessions(userId: string, scheduleId: string): string[] {
  return (db.prepare(`SELECT DISTINCT r.conversation_id AS conversationId FROM agent_runs r WHERE r.user_id = ? AND r.schedule_id = ? AND r.conversation_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM lmf_sessions s WHERE s.conversation_id = r.conversation_id)`).all(userId, scheduleId) as Array<{ conversationId: string }>).map(row => row.conversationId);
}

export function getAgentRun(userId: string, id: string) {
  const row = db.prepare("SELECT * FROM agent_runs WHERE id = ? AND user_id = ?").get(id, userId) as RunRow | undefined;
  return row ? run(row) : undefined;
}

export function listAgentRuns(userId: string, input: { status?: "active" | "finished"; limit?: number; offset?: number } = {}): { runs: AgentRun[]; total: number } {
  const filter = input.status === "active" ? "AND status IN ('queued', 'running', 'waiting')" : input.status === "finished" ? "AND status IN ('completed', 'failed', 'cancelled')" : "";
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM agent_runs WHERE user_id = ? ${filter}`).get(userId) as { n: number }).n;
  const rows = db.prepare(`SELECT * FROM agent_runs WHERE user_id = ? ${filter} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(userId, Math.min(200, input.limit ?? 50), Math.max(0, input.offset ?? 0)) as RunRow[];
  return { runs: rows.map(run), total };
}

export function queuedAgentRuns(): AgentRun[] {
  return (db.prepare("SELECT * FROM agent_runs WHERE status = 'queued' ORDER BY created_at LIMIT 500").all() as RunRow[]).map(run);
}

export function runningAgentRunCount(userId: string) {
  return (db.prepare("SELECT COUNT(*) AS n FROM agent_runs WHERE user_id = ? AND status = 'running'").get(userId) as { n: number }).n;
}

export function updateAgentRun(id: string, patch: Partial<Pick<AgentRun, "status" | "result" | "error" | "conversationId" | "startedAt" | "finishedAt" | "modelName" | "inputTokens" | "outputTokens">>) {
  const columns: Record<string, string> = { status: "status", result: "result", error: "error", conversationId: "conversation_id", startedAt: "started_at", finishedAt: "finished_at", modelName: "model_name", inputTokens: "input_tokens", outputTokens: "output_tokens" };
  const entries = Object.entries(patch).filter(([key]) => key in columns);
  if (!entries.length) return;
  db.prepare(`UPDATE agent_runs SET ${entries.map(([key]) => `${columns[key]} = ?`).join(", ")} WHERE id = ?`).run(...entries.map(([, value]) => value ?? null), id);
}

/** Runs left running when the server stopped cannot resume; they are marked failed at start. */
export function failInterruptedAgentRuns(message: string) {
  return db.prepare("UPDATE agent_runs SET status = 'failed', error = ?, finished_at = ? WHERE status IN ('running', 'waiting')").run(message, now()).changes;
}
