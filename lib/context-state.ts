import type { ToolEvent } from "./types.ts";

/**
 * What a branch sends to the model, as opposed to what its transcript shows. Shared by the server (which builds model
 * input from it) and the browser (which shows and edits it, and estimates context usage from it).
 *
 * - `summary`: every message up to and including `throughMessageId` is replaced by this text.
 * - `droppedThroughMessageId`: tool calls, tool results and reasoning of messages up to this one are left out.
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
  const dropped = id(source.droppedThroughMessageId);
  return { ...(summaryText !== undefined && summaryText.trim() && through ? { summary: { text: summaryText, throughMessageId: through } } : {}), ...(dropped ? { droppedThroughMessageId: dropped } : {}), overrides };
}

export function isEmptyContextState(state: ContextState) {
  return !state.summary && !state.droppedThroughMessageId && !Object.keys(state.overrides).length;
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
    const detailsDropped = index <= droppedIndex && (Boolean(message.reasoning) || Boolean(message.toolEvents?.length));
    if (index <= droppedIndex) message = { ...message, reasoning: undefined, toolEvents: undefined };
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
