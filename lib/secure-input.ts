import { randomUUID } from "node:crypto";
import { FILL_HELD_TOOL, REQUEST_INPUT_TOOL, type SecureInputField, type SecureInputKind } from "./secure-input-names.ts";
import type { ToolCallContext, ToolSpec } from "./tools/types.ts";

type Browser = (userId: string, conversationId: string, name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;

/**
 * Input the person types for a page on the virtual computer (user names, passwords, two-step codes) that must not
 * pass through the model. The value goes from the input card straight to the waiting tool call, which either fills
 * it into the conversation's browser page or holds it here, in memory only, for at most five minutes so the model
 * can have it filled into a later page (Google and Apple ask for the e-mail first and the password on the next
 * screen). The model only ever sees what happened, never the value, and values filled or held recently are masked
 * in the browser tools' output.
 */
export const MAX_HOLD_SECONDS = 300;
const MAX_FIELDS = 5;
const KINDS: readonly SecureInputKind[] = ["text", "email", "username", "password", "otp"];
const MASK = "[hidden input]";

type Held = { userId: string; conversationId: string; value: string; label: string; kind: SecureInputKind; expiresAt: number };
type Store = { held: Map<string, Held>; recent: Map<string, Array<{ value: string; expiresAt: number }>>; timer?: ReturnType<typeof setInterval> };
declare global { var neuralSecureInput: Store | undefined; }
const store: Store = globalThis.neuralSecureInput ??= { held: new Map(), recent: new Map() };

function sweep(now = Date.now()) {
  for (const [handle, item] of store.held) if (item.expiresAt <= now) store.held.delete(handle);
  for (const [conversationId, list] of store.recent) {
    const live = list.filter(item => item.expiresAt > now);
    if (live.length) store.recent.set(conversationId, live); else store.recent.delete(conversationId);
  }
}
store.timer ??= setInterval(() => sweep(), 15_000);
store.timer.unref?.();

function remember(conversationId: string, value: string, expiresAt: number) {
  if (!value) return;
  store.recent.set(conversationId, [...(store.recent.get(conversationId) ?? []), { value, expiresAt }]);
}

/** Replaces input values filled or held in this conversation (within their five minutes) wherever they show up. */
export function maskSecureInput<T>(conversationId: string, value: T): T {
  sweep();
  const secrets = (store.recent.get(conversationId) ?? []).map(item => item.value).filter(text => text.length >= 3).sort((a, b) => b.length - a.length);
  if (!secrets.length) return value;
  const mask = (input: unknown): unknown => {
    if (typeof input === "string") return secrets.reduce((text, secret) => text.split(secret).join(MASK), input);
    if (Array.isArray(input)) return input.map(mask);
    if (input && typeof input === "object") return Object.fromEntries(Object.entries(input).map(([key, item]) => [key, mask(item)]));
    return input;
  };
  return mask(value) as T;
}

const target = { ref: { type: "string", description: "Element ref from browser_snapshot or browser_interactive_elements (preferred)" }, selector: { type: "string", description: "CSS selector of the input (when no ref)" } };

export const SECURE_INPUT_SPECS: ToolSpec[] = [
  { name: REQUEST_INPUT_TOOL, description: "Ask the person to type values you must not see, such as a user name, e-mail, password or two-step verification code, for a page open in the virtual computer's browser. The person gets an input card in the chat; what they type never reaches you. A field with a ref or selector is filled into that input of the current page as soon as they submit (submit: true also presses Enter there). A field without one is held by NeuralNetUI for hold_seconds (at most 300) and you get a handle: fill it later with fill_held_input, e.g. when a sign-in asks for the e-mail first and the password on the next screen. Ask for everything a sign-in will need in one card when you can. You get back which fields were filled or held, never the values.", inputSchema: {
    type: "object", additionalProperties: false, required: ["title", "fields"],
    properties: {
      title: { type: "string", description: "Short card title, e.g. 'Google sign-in'" },
      description: { type: "string", description: "One line: what the input is for and where it goes (site name)" },
      fields: { type: "array", minItems: 1, maxItems: MAX_FIELDS, items: { type: "object", additionalProperties: false, required: ["id", "label", "kind"], properties: {
        id: { type: "string", description: "Your id for the field, e.g. 'email'" }, label: { type: "string", description: "Label shown to the person" },
        kind: { type: "string", enum: [...KINDS], description: "password and otp are typed hidden" }, ...target,
        submit: { type: "boolean", description: "Press Enter in this input after filling it" } } } },
      hold_seconds: { type: "integer", minimum: 30, maximum: MAX_HOLD_SECONDS, description: "How long fields without a target are held (default and maximum 300)" },
    } } },
  { name: FILL_HELD_TOOL, description: "Fill a value held by request_user_input into an input of the current page in the virtual computer's browser, without seeing it. The held value is deleted once filled; held values also expire after their hold time (at most five minutes), after which you must ask again.", inputSchema: {
    type: "object", additionalProperties: false, required: ["handle"],
    properties: { handle: { type: "string", description: "Handle returned by request_user_input" }, ...target, submit: { type: "boolean", description: "Press Enter in this input after filling it" } } } },
];

function parseFields(raw: unknown): SecureInputField[] {
  if (!Array.isArray(raw) || !raw.length) throw new Error("fields must list at least one field.");
  if (raw.length > MAX_FIELDS) throw new Error(`At most ${MAX_FIELDS} fields per card.`);
  const seen = new Set<string>();
  return raw.map((item, index) => {
    const value = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const id = String(value.id || `field${index + 1}`).trim().slice(0, 40);
    if (seen.has(id)) throw new Error(`Duplicate field id ${id}.`); seen.add(id);
    const kind = KINDS.includes(value.kind as SecureInputKind) ? value.kind as SecureInputKind : "text";
    const text = (key: string, max: number) => typeof value[key] === "string" && (value[key] as string).trim() ? (value[key] as string).trim().slice(0, max) : undefined;
    return { id, label: text("label", 80) || id, kind, ref: text("ref", 80), selector: text("selector", 400), submit: value.submit === true };
  });
}

async function fillInto(ctx: ToolCallContext, field: { ref?: string; selector?: string; submit?: boolean }, value: string, browser: Browser) {
  const where = field.ref ? { ref: field.ref } : { selector: field.selector };
  const response = await browser(ctx.userId, ctx.conversationId, "browser_fill", { ...where, value }, ctx.signal);
  const failed = (response as { isError?: boolean }).isError === true;
  if (failed) throw new Error("The browser could not fill that input. Check the ref or selector with browser_snapshot.");
  if (field.submit) await browser(ctx.userId, ctx.conversationId, "browser_press_key", { key: "Enter", ...(field.selector ? { selector: field.selector } : {}) }, ctx.signal);
}

export async function runSecureInputTool(name: string, args: Record<string, unknown>, ctx: ToolCallContext, browserCall?: Browser): Promise<{ result: unknown }> {
  const browser: Browser = browserCall ?? (await import("./obscura")).callObscuraTool;
  if (name === REQUEST_INPUT_TOOL) {
    const fields = parseFields(args.fields);
    const hold = Math.min(MAX_HOLD_SECONDS, Math.max(30, Math.round(Number(args.hold_seconds) || MAX_HOLD_SECONDS)));
    const answer = await ctx.waitForUser() as { cancelled?: boolean; values?: Record<string, unknown> } | undefined;
    if (!answer || answer.cancelled || !answer.values) return { result: { status: "cancelled", message: "The person closed the input card without entering anything." } };
    const expiresAt = Date.now() + hold * 1000;
    const outcome = [];
    for (const field of fields) {
      const value = typeof answer.values[field.id] === "string" ? String(answer.values[field.id]) : "";
      if (!value) { outcome.push({ id: field.id, label: field.label, status: "empty" }); continue; }
      remember(ctx.conversationId, value, expiresAt);
      if (field.ref || field.selector) {
        try { await fillInto(ctx, field, value, browser); outcome.push({ id: field.id, label: field.label, status: "filled", ...(field.submit ? { submitted: true } : {}) }); }
        catch (error) {
          // Not lost: held instead, so it can be filled into the right input.
          const handle = `held_${randomUUID().slice(0, 12)}`;
          store.held.set(handle, { userId: ctx.userId, conversationId: ctx.conversationId, value, label: field.label, kind: field.kind, expiresAt });
          outcome.push({ id: field.id, label: field.label, status: "held", handle, expiresAt: new Date(expiresAt).toISOString(), note: `Filling failed (${error instanceof Error ? error.message : String(error)}); the value is held instead.` });
        }
      } else {
        const handle = `held_${randomUUID().slice(0, 12)}`;
        store.held.set(handle, { userId: ctx.userId, conversationId: ctx.conversationId, value, label: field.label, kind: field.kind, expiresAt });
        outcome.push({ id: field.id, label: field.label, status: "held", handle, expiresAt: new Date(expiresAt).toISOString() });
      }
    }
    return { result: { status: "submitted", fields: outcome, note: "The values were not shown to you and must not be asked for in the chat." } };
  }
  if (name === FILL_HELD_TOOL) {
    sweep();
    const handle = String(args.handle || "").trim();
    const held = store.held.get(handle);
    if (!held || held.userId !== ctx.userId || held.conversationId !== ctx.conversationId) return { result: { status: "expired", message: "No held value with that handle: it was used, or its hold time passed. Ask the person again with request_user_input." } };
    const ref = typeof args.ref === "string" && args.ref.trim() ? args.ref.trim() : undefined, selector = typeof args.selector === "string" && args.selector.trim() ? args.selector.trim() : undefined;
    if (!ref && !selector) throw new Error("Give the ref or selector of the input to fill.");
    await fillInto(ctx, { ref, selector, submit: args.submit === true }, held.value, browser);
    store.held.delete(handle);
    return { result: { status: "filled", label: held.label, ...(args.submit === true ? { submitted: true } : {}) } };
  }
  throw new Error(`Unknown input tool ${name}.`);
}
