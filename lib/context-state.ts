import type { ToolEvent } from "./types.ts";

/**
 * What a branch sends to the model, as opposed to what its transcript shows. Shared by the server (which builds model
 * input from it) and the browser (which shows and edits it, and estimates context usage from it).
 *
 * - `summary`: every message up to and including `throughMessageId` is replaced by this text.
 * - `droppedThroughMessageId`: tool calls, tool results and reasoning of messages up to this one are left out.
 * - `toolsTracedThroughMessageId`: tool calls and results of messages up to this one are left out, and each change the
 *   agent made with its own tools (a subagent started, a schedule or a workboard item changed) stays as one line in
 *   the reply, built from the call itself (no model is asked). Lookups leave nothing. Used by the agent's main chat.
 * - `overrides`: per-message edits made in the context view. The transcript keeps the original.
 *
 * Message ids that are not in the branch (deleted, or not yet part of a fork) are ignored, so a state copied from a
 * parent branch is always safe to apply.
 */
export interface ContextToolOverride { arguments?: unknown; result?: unknown; removed?: boolean }
export interface ContextMessageOverride {
  content?: string;
  reasoning?: string;
  removeReasoning?: boolean;
  tools?: Record<string, ContextToolOverride>;
  removed?: boolean;
}
export interface ContextState {
  summary?: { text: string; throughMessageId: string };
  droppedThroughMessageId?: string;
  toolsTracedThroughMessageId?: string;
  overrides: Record<string, ContextMessageOverride>;
}

export const EMPTY_CONTEXT_STATE: ContextState = Object.freeze({ overrides: {} }) as ContextState;

const MAX_TEXT = 2_000_000;
const MAX_OVERRIDES = 5000;
const ID = /^[A-Za-z0-9_.:-]{1,200}$/;
const record = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const text = (value: unknown) => typeof value === "string" && value.length <= MAX_TEXT ? value : undefined;
const id = (value: unknown) => typeof value === "string" && ID.test(value) ? value : undefined;

function normalizeTool(value: unknown): ContextToolOverride | undefined {
  const source = record(value);
  if (!source) return undefined;
  const result: ContextToolOverride = {};
  if ("arguments" in source) result.arguments = source.arguments;
  if ("result" in source) result.result = source.result;
  if (source.removed === true) result.removed = true;
  return Object.keys(result).length ? result : undefined;
}

function normalizeOverride(value: unknown): ContextMessageOverride | undefined {
  const source = record(value);
  if (!source) return undefined;
  const result: ContextMessageOverride = {};
  const content = text(source.content); if (content !== undefined) result.content = content;
  const reasoning = text(source.reasoning); if (reasoning !== undefined) result.reasoning = reasoning;
  if (source.removeReasoning === true) result.removeReasoning = true;
  if (source.removed === true) result.removed = true;
  const tools = Object.fromEntries(Object.entries(record(source.tools) || {}).flatMap(([key, tool]) => { const normalized = id(key) && normalizeTool(tool); return normalized ? [[key, normalized]] : []; }));
  if (Object.keys(tools).length) result.tools = tools;
  return Object.keys(result).length ? result : undefined;
}

export function normalizeContextState(input: unknown): ContextState {
  const source = record(input) || {};
  const summarySource = record(source.summary);
  const summaryText = text(summarySource?.text), through = id(summarySource?.throughMessageId);
  const overrides: Record<string, ContextMessageOverride> = {};
  for (const [key, value] of Object.entries(record(source.overrides) || {})) {
    if (Object.keys(overrides).length >= MAX_OVERRIDES) break;
    const normalized = id(key) && normalizeOverride(value);
    if (normalized) overrides[key] = normalized;
  }
  const dropped = id(source.droppedThroughMessageId), traced = id(source.toolsTracedThroughMessageId);
  return { ...(summaryText !== undefined && summaryText.trim() && through ? { summary: { text: summaryText, throughMessageId: through } } : {}), ...(dropped ? { droppedThroughMessageId: dropped } : {}), ...(traced ? { toolsTracedThroughMessageId: traced } : {}), overrides };
}

export function isEmptyContextState(state: ContextState) {
  return !state.summary && !state.droppedThroughMessageId && !state.toolsTracedThroughMessageId && !Object.keys(state.overrides).length;
}

/** The fields of a transcript message that model input is built from. */
export interface ContextSourceMessage { id?: string; role: string; content: string; reasoning?: string; toolEvents?: ToolEvent[] }

export interface ContextEntry<T extends ContextSourceMessage> {
  /** The message as the model will see it: overrides applied, details removed where dropped. */
  message: T;
  /** The transcript message it comes from. */
  original: T;
  overridden: boolean;
  detailsDropped: boolean;
}

export interface AppliedContext<T extends ContextSourceMessage> {
  summary?: string;
  /** Messages folded into the summary, oldest first. Empty without a summary. */
  summarized: T[];
  entries: ContextEntry<T>[];
}

/** Applies a branch's context state to its transcript messages. */
export function applyContextState<T extends ContextSourceMessage>(messages: T[], state: ContextState | undefined): AppliedContext<T> {
  if (!state) return { summarized: [], entries: messages.map(message => ({ message, original: message, overridden: false, detailsDropped: false })) };
  const summaryIndex = state.summary ? messages.findIndex(message => message.id === state.summary!.throughMessageId) : -1;
  const droppedIndex = state.droppedThroughMessageId ? messages.findIndex(message => message.id === state.droppedThroughMessageId) : -1;
  const tracedIndex = state.toolsTracedThroughMessageId ? messages.findIndex(message => message.id === state.toolsTracedThroughMessageId) : -1;
  const entries: ContextEntry<T>[] = [];
  messages.forEach((original, index) => {
    if (index <= summaryIndex) return;
    const override = original.id ? state.overrides[original.id] : undefined;
    if (override?.removed) return;
    let message: T = original;
    if (override) {
      const tools = (original.toolEvents || []).flatMap(event => {
        const change = override.tools?.[event.id];
        if (change?.removed) return [];
        return [{ ...event, ...(change && "arguments" in change ? { arguments: change.arguments } : {}), ...(change && "result" in change ? { result: change.result } : {}) }];
      });
      message = {
        ...original,
        ...(override.content !== undefined ? { content: override.content } : {}),
        ...(override.removeReasoning ? { reasoning: undefined } : override.reasoning !== undefined ? { reasoning: override.reasoning } : {}),
        ...(original.toolEvents ? { toolEvents: tools } : {}),
      };
    }
    const traced = index <= tracedIndex && index > droppedIndex && Boolean(message.toolEvents?.length);
    const detailsDropped = traced || index <= droppedIndex && (Boolean(message.reasoning) || Boolean(message.toolEvents?.length));
    if (index <= droppedIndex) message = { ...message, reasoning: undefined, toolEvents: undefined };
    else if (traced) {
      const lines = (message.toolEvents || []).map(toolTrace).filter((line): line is string => Boolean(line));
      message = { ...message, content: [message.content.trim(), ...lines].filter(Boolean).join("\n\n"), toolEvents: undefined };
    }
    if (message.role === "assistant" && !message.content.trim() && !message.toolEvents?.length) return;
    entries.push({ message, original, overridden: Boolean(override), detailsDropped });
  });
  return { ...(summaryIndex >= 0 ? { summary: state.summary!.text } : {}), summarized: summaryIndex >= 0 ? messages.slice(0, summaryIndex + 1) : [], entries };
}

/** True when the message is folded into the branch's current summary. */
export function isSummarized(messages: ContextSourceMessage[], state: ContextState | undefined, messageId: string) {
  if (!state?.summary) return false;
  const through = messages.findIndex(message => message.id === state.summary!.throughMessageId);
  const target = messages.findIndex(message => message.id === messageId);
  return through >= 0 && target >= 0 && target <= through;
}

/** After the transcript text of a message is edited, the context follows the transcript again for that text. */
export function withoutContentOverride(state: ContextState, messageId: string): ContextState {
  const current = state.overrides[messageId];
  if (!current || current.content === undefined) return state;
  const { content: _content, ...rest } = current;
  const overrides = { ...state.overrides };
  if (Object.keys(rest).length) overrides[messageId] = rest; else delete overrides[messageId];
  return { ...state, overrides };
}

/** The id of the message just before the newest user message: what a send-time compaction covers. */
export function messageBeforeLatestUser(messages: Array<{ id?: string; role: string }>) {
  const latest = messages.findLastIndex(message => message.role === "user");
  return latest > 0 ? messages[latest - 1].id : undefined;
}

/**
 * Where the kept part of a conversation starts when earlier turns are compacted: at the user message that opens the
 * `keepTurns`-th most recent question-and-answer pair. `pending` means the newest user message is the request being
 * sent now (not yet answered), which is always kept on top of the pairs. With fewer turns than that, as many are kept
 * as still leaves the oldest turn to fold, so a conversation of a few long turns can still be compacted. Returns the
 * message count when everything may be folded (nothing kept).
 */
export function keptTurnsStart(messages: Array<{ role: string }>, keepTurns: number, pending: boolean): number {
  const users = messages.flatMap((message, index) => message.role === "user" ? [index] : []);
  const count = Math.max(0, Math.floor(keepTurns)) + (pending ? 1 : 0);
  if (!count) return messages.length;
  if (users.length <= 1) return users.length ? users[0] : messages.length;
  return users[Math.max(1, users.length - count)];
}

/** The stored message just before the kept turns: what a compaction keeping `keepTurns` pairs covers. */
export function messageBeforeKeptTurns(messages: Array<{ id?: string; role: string }>, keepTurns: number, pending: boolean) {
  const start = keptTurnsStart(messages, keepTurns, pending);
  return start > 0 ? messages[start - 1].id : undefined;
}

const quoted = (value: unknown) => typeof value === "string" && value.trim() ? `"${value.trim().slice(0, 120)}"` : "";
const field = (value: unknown, key: string) => value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;

/**
 * One line standing in for an agent tool call once its record is left out (`toolsTracedThroughMessageId`), built from
 * the call's own arguments and result: what was started or changed, with the id to refer to it later. Lookups, other
 * tools and calls that failed or were refused leave nothing.
 */
export function toolTrace(event: Pick<ToolEvent, "name" | "status" | "arguments" | "result">): string | undefined {
  const args = event.arguments && typeof event.arguments === "object" ? event.arguments as Record<string, unknown> : {};
  const result = event.result;
  if (event.status === "error" || field(result, "error") || field(result, "executed") === false || field(result, "rejected")) return undefined;
  const id = (value: unknown) => typeof value === "string" && value ? value : undefined;
  const changed = (keys: string[]) => keys.filter(key => args[key] !== undefined).map(key => key === "instructions" || key === "body" ? key : `${key} ${typeof args[key] === "string" ? quoted(args[key]) : JSON.stringify(args[key])}`).join(", ");
  switch (event.name) {
    case "spawn_subagent": return `[Delegated to a subagent] ${quoted(args.title)} (run id ${id(field(result, "id")) ?? "?"})`;
    case "notify_wakeup": {
      const every = field(result, "intervalMinutes") ?? args.every_minutes;
      const when = typeof every === "number" ? `every ${every} min` : `once${id(field(result, "nextRunAt")) ? ` at ${field(result, "nextRunAt")}` : ""}`;
      return `[Scheduled] ${quoted(args.title)} ${when} (schedule id ${id(field(result, "id")) ?? "?"})`;
    }
    case "update_wakeup": return `[Schedule changed] ${id(args.id) ?? "?"}${changed(["title", "every_minutes", "at", "enabled", "instructions"]) ? `: ${changed(["title", "every_minutes", "at", "enabled", "instructions"])}` : ""}`;
    case "cancel_wakeup": return `[Schedule cancelled] ${id(args.id) ?? "?"}`;
    case "workboard_add": return `[Workboard ${typeof args.kind === "string" ? args.kind : "item"} added] ${quoted(args.title)} (id ${id(field(result, "id")) ?? "?"})`;
    case "workboard_update": return `[Workboard item changed] ${id(args.id) ?? "?"}${changed(["title", "status", "starts_at", "ends_at", "body"]) ? `: ${changed(["title", "status", "starts_at", "ends_at", "body"])}` : ""}`;
    case "workboard_remove": return `[Workboard item removed] ${id(args.id) ?? "?"}`;
    default: return undefined;
  }
}
