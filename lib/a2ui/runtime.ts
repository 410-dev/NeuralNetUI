import { BASIC_CATALOG_ID } from "./catalog.ts";
import type { ToolEvent } from "../types.ts";

/**
 * A2UI v1.0 surface state and expression evaluation, shared by the server (validation, history) and the renderer.
 * Pure functions only: no DOM, no React.
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface A2uiComponent { id: string; component: string; [key: string]: unknown }

export interface SurfaceState {
  surfaceId: string;
  catalogId: string;
  sendDataModel: boolean;
  components: Record<string, A2uiComponent>;
  dataModel: Json;
  deleted: boolean;
  /** Bumped on every change, so a renderer can tell when the agent moved the data model under local edits. */
  revision: number;
  /** The tool call that created the surface; it is drawn there. */
  createdBy?: string;
}

export type AgentMessage = {
  version: string;
  createSurface?: { surfaceId: string; catalogId?: string; sendDataModel?: boolean; components?: A2uiComponent[]; dataModel?: Json; metadata?: unknown };
  updateComponents?: { surfaceId: string; components: A2uiComponent[] };
  updateDataModel?: { surfaceId: string; path?: string; value?: Json };
  deleteSurface?: { surfaceId: string };
};

/** The outbound `action` message of the renderer-to-agent stream. */
export interface ActionMessage {
  version: "1.0";
  action: { name: string; surfaceId: string; sourceComponentId: string; timestamp: string; context: Record<string, Json>; userMessage?: string };
}

// ---------------------------------------------------------------- JSON Pointer (RFC 6901)

const unescape = (token: string) => token.replace(/~1/g, "/").replace(/~0/g, "~");
export function pointerTokens(pointer: string) {
  if (pointer === "" || pointer === "/") return [];
  return pointer.replace(/^\//, "").split("/").map(unescape);
}
export function getAt(model: Json, pointer: string): Json | undefined {
  let node: Json | undefined = model;
  for (const token of pointerTokens(pointer)) {
    if (node === null || typeof node !== "object") return undefined;
    node = Array.isArray(node) ? node[Number(token)] : (node as Record<string, Json>)[token];
  }
  return node;
}
/** Returns a copy with `value` placed at `pointer` (null deletes), creating containers on the way. */
export function setAt(model: Json, pointer: string, value: Json | undefined): Json {
  const tokens = pointerTokens(pointer);
  if (!tokens.length) return value === undefined ? {} : value;
  const write = (node: Json | undefined, index: number): Json => {
    const token = tokens[index];
    const container: Json = node !== null && typeof node === "object" ? (Array.isArray(node) ? [...node] : { ...node }) : (/^\d+$/.test(token) ? [] : {});
    const last = index === tokens.length - 1;
    if (Array.isArray(container)) {
      const at = token === "-" ? container.length : Number(token);
      if (last) { if (value === null || value === undefined) container.splice(at, 1); else container[at] = value; }
      else container[at] = write(container[at], index + 1);
    } else {
      const record = container as Record<string, Json>;
      if (last) { if (value === null || value === undefined) delete record[token]; else record[token] = value; }
      else record[token] = write(record[token], index + 1);
    }
    return container;
  };
  return write(model, 0);
}

/** Resolves a binding path against the current template scope: absolute paths start at the root. */
export function joinPath(scope: string, path: string) {
  if (path.startsWith("/")) return path;
  const base = scope.replace(/\/$/, "");
  return `${base}/${path}`.replace(/\/+/g, "/") || "/";
}

// ---------------------------------------------------------------- surfaces

export function emptySurface(surfaceId: string): SurfaceState {
  return { surfaceId, catalogId: BASIC_CATALOG_ID, sendDataModel: false, components: {}, dataModel: {}, deleted: false, revision: 0 };
}

/** Applies agent messages in order. Unknown surfaces in update messages are ignored (the validator reports them). */
export function applyMessages(surfaces: Record<string, SurfaceState>, messages: AgentMessage[], createdBy?: string): Record<string, SurfaceState> {
  const next = { ...surfaces };
  for (const message of messages) {
    if (message.createSurface) {
      const create = message.createSurface;
      const surface: SurfaceState = { ...emptySurface(create.surfaceId), catalogId: create.catalogId || BASIC_CATALOG_ID, sendDataModel: create.sendDataModel === true, dataModel: create.dataModel ?? {}, createdBy, revision: (next[create.surfaceId]?.revision ?? 0) + 1 };
      for (const component of create.components || []) surface.components[component.id] = component;
      next[create.surfaceId] = surface;
    } else if (message.updateComponents) {
      const current = next[message.updateComponents.surfaceId];
      if (!current || current.deleted) continue;
      const components = { ...current.components };
      for (const component of message.updateComponents.components || []) components[component.id] = component;
      next[current.surfaceId] = { ...current, components, revision: current.revision + 1 };
    } else if (message.updateDataModel) {
      const current = next[message.updateDataModel.surfaceId];
      if (!current || current.deleted) continue;
      next[current.surfaceId] = { ...current, dataModel: setAt(current.dataModel, message.updateDataModel.path || "/", message.updateDataModel.value ?? null), revision: current.revision + 1 };
    } else if (message.deleteSurface) {
      const current = next[message.deleteSurface.surfaceId];
      if (current) next[current.surfaceId] = { ...current, deleted: true, revision: current.revision + 1 };
    }
  }
  return next;
}

/** The A2UI messages a `render_ui` call carried (its arguments), or none. */
export function messagesOf(args: unknown): AgentMessage[] {
  const value = args && typeof args === "object" ? (args as { messages?: unknown }).messages : undefined;
  return Array.isArray(value) ? value.filter((item): item is AgentMessage => Boolean(item) && typeof item === "object") : [];
}

/** Surfaces the conversation's accepted render_ui calls left on screen, in order (rejected calls changed nothing). */
export function a2uiSurfaces(events: ToolEvent[]): Record<string, SurfaceState> {
  let surfaces: Record<string, SurfaceState> = {};
  for (const event of events) {
    if (event.name !== "render_ui" || event.status !== "completed") continue;
    const result = event.result && typeof event.result === "object" ? event.result as { ok?: unknown } : {};
    if (result.ok === true) surfaces = applyMessages(surfaces, messagesOf(event.arguments), event.id);
  }
  return surfaces;
}

// ---------------------------------------------------------------- evaluation

export interface EvalScope {
  model: Json;
  /** Data path of the template item being rendered ("" outside templates). */
  scope: string;
  /** 0-based index inside a list template. */
  index?: number;
  locale?: string;
}

export interface ValidationResult { valid: boolean; message?: string }

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
export const isBinding = (value: unknown): value is { "@path": string } => isRecord(value) && typeof value["@path"] === "string";
export const isCall = (value: unknown): value is { "@call": string; args?: Record<string, unknown> } => isRecord(value) && typeof value["@call"] === "string";

/** Resolves a dynamic value: a literal, {"@path"} or {"@call"}. */
export function resolveValue(value: unknown, scope: EvalScope): unknown {
  if (isBinding(value)) return getAt(scope.model, joinPath(scope.scope, value["@path"]));
  if (isCall(value)) return callFunction(value["@call"], value.args || {}, scope);
  return value;
}

export function resolveString(value: unknown, scope: EvalScope): string {
  const resolved = resolveValue(value, scope);
  if (resolved === undefined || resolved === null) return "";
  if (typeof resolved === "object") return isValidation(resolved) ? String(resolved.valid) : JSON.stringify(resolved);
  return String(resolved);
}

export function resolveNumber(value: unknown, scope: EvalScope, fallback = 0): number {
  const resolved = Number(resolveValue(value, scope));
  return Number.isFinite(resolved) ? resolved : fallback;
}

export function resolveBoolean(value: unknown, scope: EvalScope): boolean {
  const resolved = resolveValue(value, scope);
  if (isValidation(resolved)) return resolved.valid;
  return resolved === true || resolved === "true";
}

const isValidation = (value: unknown): value is ValidationResult => isRecord(value) && typeof value.valid === "boolean";
const asValidation = (value: unknown): ValidationResult => isValidation(value) ? value : { valid: Boolean(value) };

/** Runs a component's @checks; the first failing check's message wins. */
export function runChecks(checks: unknown, scope: EvalScope): ValidationResult {
  if (!Array.isArray(checks)) return { valid: true };
  for (const check of checks) {
    if (!isRecord(check)) continue;
    const result = asValidation(resolveValue(check.condition, scope));
    if (!result.valid) return { valid: false, message: typeof check.message === "string" ? check.message : result.message };
  }
  return { valid: true };
}

const empty = (value: unknown) => value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);

export function callFunction(name: string, rawArgs: Record<string, unknown>, scope: EvalScope): unknown {
  const arg = (key: string) => resolveValue(rawArgs[key], scope);
  const text = (key: string) => resolveString(rawArgs[key], scope);
  const num = (key: string) => { const value = arg(key); return value === undefined || value === null || value === "" ? undefined : Number(value); };
  switch (name) {
    case "@index": return (scope.index ?? 0) + (Number(arg("offset")) || 0);
    case "required": return { valid: !empty(arg("value")), message: "This field is required." };
    case "regex": {
      const pattern = String(rawArgs.pattern ?? "");
      if (pattern.length > 256) return { valid: false, message: "Pattern too long." };
      const value = text("value").slice(0, 4096);
      try { return { valid: new RegExp(pattern, "u").test(value), message: "Invalid format." }; } catch { return { valid: false, message: "Invalid pattern." }; }
    }
    case "length": {
      const length = [...text("value")].length, min = num("min"), max = num("max");
      return { valid: (min === undefined || length >= min) && (max === undefined || length <= max), message: max !== undefined && length > max ? `At most ${max} characters.` : `At least ${min ?? 0} characters.` };
    }
    case "numeric": {
      const value = Number(arg("value")), min = num("min"), max = num("max");
      if (!Number.isFinite(value)) return { valid: false, message: "Value must be a valid number." };
      return { valid: (min === undefined || value >= min) && (max === undefined || value <= max), message: `Must be between ${min ?? "-∞"} and ${max ?? "∞"}.` };
    }
    case "email": return { valid: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text("value")), message: "Enter a valid email address." };
    case "formatString": return interpolate(String(rawArgs.value ?? ""), scope);
    case "formatNumber": {
      const value = Number(arg("value")); if (!Number.isFinite(value)) return "";
      const decimals = num("decimals"); const grouping = rawArgs.grouping === undefined ? true : resolveBoolean(rawArgs.grouping, scope);
      return new Intl.NumberFormat(scope.locale, { ...(decimals !== undefined ? { minimumFractionDigits: decimals, maximumFractionDigits: decimals } : {}), useGrouping: grouping }).format(value);
    }
    case "formatCurrency": {
      const value = Number(arg("value")); if (!Number.isFinite(value)) return "";
      const decimals = num("decimals"); const grouping = rawArgs.grouping === undefined ? true : resolveBoolean(rawArgs.grouping, scope);
      try { return new Intl.NumberFormat(scope.locale, { style: "currency", currency: text("currency") || "USD", ...(decimals !== undefined ? { minimumFractionDigits: decimals, maximumFractionDigits: decimals } : {}), useGrouping: grouping }).format(value); }
      catch { return `${value} ${text("currency")}`; }
    }
    case "formatDate": return formatDate(arg("value"), text("format"), scope.locale);
    case "pluralize": {
      const value = Number(arg("value"));
      const category = value === 0 && rawArgs.zero !== undefined ? "zero" : new Intl.PluralRules(scope.locale).select(value);
      return text(rawArgs[category] !== undefined ? category : "other");
    }
    case "and": return Array.isArray(rawArgs.values) && rawArgs.values.every(item => resolveBoolean(item, scope));
    case "or": return Array.isArray(rawArgs.values) && rawArgs.values.some(item => resolveBoolean(item, scope));
    case "not": return !resolveBoolean(rawArgs.value, scope);
    case "openUrl": return undefined;
    default: return undefined;
  }
}

// ---------------------------------------------------------------- ${...} expressions

/** Splits on unescaped ${...} at depth one, keeping nested braces inside an expression. */
function expressions(template: string): Array<{ literal: string } | { expr: string }> {
  const parts: Array<{ literal: string } | { expr: string }> = [];
  let literal = "", index = 0;
  while (index < template.length) {
    if (template.startsWith("\\${", index)) { literal += "${"; index += 3; continue; }
    if (template.startsWith("${", index)) {
      let depth = 1, end = index + 2;
      while (end < template.length && depth > 0) { if (template.startsWith("${", end)) { depth++; end += 2; continue; } if (template[end] === "}") depth--; end++; }
      if (depth !== 0) { literal += template.slice(index); break; }
      if (literal) { parts.push({ literal }); literal = ""; }
      parts.push({ expr: template.slice(index + 2, end - 1).trim() });
      index = end; continue;
    }
    literal += template[index++];
  }
  if (literal) parts.push({ literal });
  return parts;
}

/** Evaluates `path`, `fn(name: value, ...)`, quoted strings, numbers and booleans. */
function evaluateExpression(expr: string, scope: EvalScope, depth = 0): unknown {
  if (depth > 8) return "";
  const call = /^([A-Za-z@][\w@]*)\s*\(([\s\S]*)\)$/.exec(expr);
  if (call) {
    const args: Record<string, unknown> = {};
    for (const part of splitArgs(call[2])) {
      const named = /^([A-Za-z_]\w*)\s*:\s*([\s\S]+)$/.exec(part.trim());
      if (named) args[named[1]] = literalOrBinding(named[2].trim(), scope, depth);
    }
    return callFunction(call[1], args, scope);
  }
  const value = literalOrBinding(expr, scope, depth);
  return isBinding(value) ? resolveValue(value, scope) : value;
}

function literalOrBinding(token: string, scope: EvalScope, depth: number): unknown {
  if (/^'[\s\S]*'$|^"[\s\S]*"$/.test(token)) return token.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
  if (token === "true" || token === "false") return token === "true";
  if (token.startsWith("${") && token.endsWith("}")) return evaluateExpression(token.slice(2, -1).trim(), scope, depth + 1);
  if (/^[A-Za-z@][\w@]*\s*\(/.test(token)) return evaluateExpression(token, scope, depth + 1);
  return { "@path": token };
}

function splitArgs(text: string) {
  const parts: string[] = []; let depth = 0, quote = "", current = "";
  for (const char of text) {
    if (quote) { current += char; if (char === quote) quote = ""; continue; }
    if (char === "'" || char === "\"") { quote = char; current += char; continue; }
    if (char === "(" || char === "{") depth++;
    if (char === ")" || char === "}") depth--;
    if (char === "," && depth === 0) { parts.push(current); current = ""; continue; }
    current += char;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

export function interpolate(template: string, scope: EvalScope): string {
  return expressions(template).map(part => {
    if ("literal" in part) return part.literal;
    const value = evaluateExpression(part.expr, scope);
    if (value === undefined || value === null) return "";
    return typeof value === "object" ? (isValidation(value) ? String(value.valid) : JSON.stringify(value)) : String(value);
  }).join("");
}

// ---------------------------------------------------------------- dates (Unicode TR35 subset)

function formatDate(value: unknown, pattern: string, locale?: string) {
  const date = value instanceof Date ? value : new Date(typeof value === "number" ? value : String(value ?? ""));
  if (Number.isNaN(date.getTime())) return "";
  const part = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, options).format(date);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  const tokens: Record<string, () => string> = {
    yyyy: () => String(date.getFullYear()), yy: () => pad(date.getFullYear() % 100), y: () => String(date.getFullYear()),
    MMMM: () => part({ month: "long" }), MMM: () => part({ month: "short" }), MM: () => pad(date.getMonth() + 1), M: () => String(date.getMonth() + 1),
    dd: () => pad(date.getDate()), d: () => String(date.getDate()),
    EEEE: () => part({ weekday: "long" }), EEE: () => part({ weekday: "short" }), E: () => part({ weekday: "short" }),
    HH: () => pad(date.getHours()), H: () => String(date.getHours()),
    hh: () => pad(date.getHours() % 12 || 12), h: () => String(date.getHours() % 12 || 12),
    mm: () => pad(date.getMinutes()), m: () => String(date.getMinutes()),
    ss: () => pad(date.getSeconds()), s: () => String(date.getSeconds()),
    a: () => (date.getHours() < 12 ? "AM" : "PM"),
  };
  let out = "", index = 0;
  while (index < pattern.length) {
    if (pattern[index] === "'") { const end = pattern.indexOf("'", index + 1); out += pattern.slice(index + 1, end < 0 ? undefined : end); index = end < 0 ? pattern.length : end + 1; continue; }
    const token = Object.keys(tokens).find(key => pattern.startsWith(key, index));
    if (token) { out += tokens[token](); index += token.length; } else out += pattern[index++];
  }
  return out;
}
