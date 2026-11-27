import { A2UI_VERSION, BASIC_CATALOG_ID, COMMON_PROPS, COMPONENTS, FUNCTIONS, ICON_NAMES, type PropKind } from "./catalog.ts";
import { applyMessages, type AgentMessage, type SurfaceState } from "./runtime.ts";

/**
 * Checks a batch of A2UI v1.0 agent-to-renderer messages against the basic catalog and the surfaces already on
 * screen. Errors are written for the model: each names the message, component and property, so it can fix them.
 */

export const LIMITS = { bytes: 200_000, components: 400, depth: 40 } as const;
const MESSAGE_KEYS = ["createSurface", "updateComponents", "updateDataModel", "deleteSurface"] as const;
const ID = /^[A-Za-z0-9_.:-]{1,80}$/;

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export interface ValidationOutcome { errors: string[]; surfaces: Record<string, SurfaceState>; touched: string[] }

export function validateMessages(input: unknown, existing: Record<string, SurfaceState>): ValidationOutcome {
  const errors: string[] = [];
  const fail = (text: string) => { if (errors.length < 40) errors.push(text); };
  if (!Array.isArray(input) || !input.length) return { errors: ["`messages` must be a non-empty array of A2UI v1.0 messages."], surfaces: existing, touched: [] };
  if (JSON.stringify(input).length > LIMITS.bytes) return { errors: [`The messages are larger than ${LIMITS.bytes} bytes; split the UI or simplify it.`], surfaces: existing, touched: [] };

  const live = (surfaces: Record<string, SurfaceState>, id: string) => surfaces[id] && !surfaces[id].deleted;
  let surfaces = existing;
  const touched = new Set<string>();

  input.forEach((raw, index) => {
    const at = `messages[${index}]`;
    if (!isRecord(raw)) { fail(`${at} is not an object.`); return; }
    if (raw.version !== A2UI_VERSION) fail(`${at}.version must be "${A2UI_VERSION}".`);
    const keys = MESSAGE_KEYS.filter(key => key in raw);
    const extra = Object.keys(raw).filter(key => key !== "version" && !MESSAGE_KEYS.includes(key as typeof MESSAGE_KEYS[number]));
    if (keys.length !== 1) { fail(`${at} must contain exactly one of ${MESSAGE_KEYS.join(", ")}${extra.length ? ` (found ${extra.join(", ")})` : ""}.`); return; }
    if (extra.length) fail(`${at} has unsupported keys: ${extra.join(", ")}.`);
    const kind = keys[0];
    const body = raw[kind];
    if (!isRecord(body)) { fail(`${at}.${kind} must be an object.`); return; }
    const surfaceId = body.surfaceId;
    if (typeof surfaceId !== "string" || !ID.test(surfaceId)) { fail(`${at}.${kind}.surfaceId must be a short identifier.`); return; }

    if (kind === "createSurface") {
      if (live(surfaces, surfaceId)) fail(`${at}: surface "${surfaceId}" already exists; use updateComponents/updateDataModel, or deleteSurface first.`);
      if (body.catalogId !== undefined && body.catalogId !== BASIC_CATALOG_ID) fail(`${at}.createSurface.catalogId must be "${BASIC_CATALOG_ID}" (the only catalog this client supports).`);
      if (body.sendDataModel !== undefined && typeof body.sendDataModel !== "boolean") fail(`${at}.createSurface.sendDataModel must be a boolean.`);
      if (body.components !== undefined && !Array.isArray(body.components)) fail(`${at}.createSurface.components must be an array.`);
      if (body.dataModel !== undefined && !isRecord(body.dataModel)) fail(`${at}.createSurface.dataModel must be an object.`);
      checkComponents(body.components, `${at}.createSurface`, fail);
    } else if (kind === "updateComponents") {
      if (!live(surfaces, surfaceId)) fail(`${at}: surface "${surfaceId}" does not exist; create it with createSurface first.`);
      if (!Array.isArray(body.components) || !body.components.length) fail(`${at}.updateComponents.components must be a non-empty array.`);
      checkComponents(body.components, `${at}.updateComponents`, fail);
    } else if (kind === "updateDataModel") {
      if (!live(surfaces, surfaceId)) fail(`${at}: surface "${surfaceId}" does not exist.`);
      if (body.path !== undefined && (typeof body.path !== "string" || !body.path.startsWith("/"))) fail(`${at}.updateDataModel.path must be an absolute JSON Pointer such as "/user/name".`);
      if ((body.path === undefined || body.path === "/") && body.value !== undefined && !isRecord(body.value)) fail(`${at}.updateDataModel.value must be an object when it replaces the whole data model.`);
    } else if (kind === "deleteSurface") {
      if (!live(surfaces, surfaceId)) fail(`${at}: surface "${surfaceId}" does not exist.`);
    }
    surfaces = applyMessages(surfaces, [raw as AgentMessage]);
    touched.add(surfaceId);
  });

  // The finished batch must leave every touched surface drawable: a root, no dangling references, no cycles.
  for (const id of touched) {
    const surface = surfaces[id];
    if (!surface || surface.deleted) continue;
    const components = surface.components;
    const count = Object.keys(components).length;
    if (count > LIMITS.components) fail(`Surface "${id}" has ${count} components; the limit is ${LIMITS.components}.`);
    if (!components.root) { fail(`Surface "${id}" has no component with id "root".`); continue; }
    for (const component of Object.values(components)) {
      for (const ref of references(component)) if (!components[ref]) fail(`Surface "${id}": component "${component.id}" refers to "${ref}", which does not exist.`);
    }
    const seen = new Set<string>();
    const walk = (componentId: string, path: string[]): void => {
      if (path.includes(componentId)) { fail(`Surface "${id}": components form a cycle (${[...path, componentId].join(" → ")}).`); return; }
      if (path.length > LIMITS.depth) { fail(`Surface "${id}" nests deeper than ${LIMITS.depth} levels.`); return; }
      const component = components[componentId];
      if (!component || seen.has(componentId)) return;
      seen.add(componentId);
      for (const ref of references(component)) walk(ref, [...path, componentId]);
    };
    walk("root", []);
  }
  return { errors, surfaces, touched: [...touched] };
}

/** Component ids a component points at (single children, lists, templates, tabs, modal parts). */
export function references(component: Record<string, unknown>): string[] {
  const refs: string[] = [];
  for (const key of ["child", "trigger", "content"]) if (typeof component[key] === "string") refs.push(component[key] as string);
  const children = component.children;
  if (Array.isArray(children)) refs.push(...children.filter((item): item is string => typeof item === "string"));
  else if (isRecord(children) && typeof children.componentId === "string") refs.push(children.componentId);
  if (Array.isArray(component.tabs)) for (const tab of component.tabs) if (isRecord(tab) && typeof tab.child === "string") refs.push(tab.child);
  return refs;
}

function checkComponents(list: unknown, at: string, fail: (text: string) => void) {
  if (!Array.isArray(list)) return;
  const ids = new Set<string>();
  list.forEach((raw, index) => {
    const where = `${at}.components[${index}]`;
    if (!isRecord(raw)) { fail(`${where} is not an object.`); return; }
    const id = raw.id;
    if (typeof id !== "string" || !ID.test(id)) { fail(`${where}.id must be a short identifier.`); return; }
    if (ids.has(id)) fail(`${where}: duplicate id "${id}" in the same message.`);
    ids.add(id);
    const name = raw.component;
    const spec = typeof name === "string" ? COMPONENTS[name] : undefined;
    if (!spec) { fail(`Component "${id}": unknown component ${JSON.stringify(name)}. Use one of ${Object.keys(COMPONENTS).join(", ")}.`); return; }
    if (raw["@catalogId"] !== undefined && raw["@catalogId"] !== BASIC_CATALOG_ID) fail(`Component "${id}": only the basic catalog is supported.`);
    for (const key of spec.required) if (raw[key] === undefined) fail(`Component "${id}" (${name}) is missing required property "${key}".`);
    for (const [key, value] of Object.entries(raw)) {
      if (COMMON_PROPS.has(key)) continue;
      const kind = spec.props[key];
      if (!kind) { fail(`Component "${id}" (${name}) has unknown property "${key}". Allowed: ${Object.keys(spec.props).join(", ")}.`); continue; }
      const allowed = spec.enums?.[key];
      if (allowed && !allowed.includes(String(value))) { fail(`Component "${id}": ${key} must be one of ${allowed.join(", ")}.`); continue; }
      const problem = checkProp(kind, value);
      if (problem) fail(`Component "${id}" (${name}).${key}: ${problem}`);
    }
  });
}

function checkDynamic(value: unknown, literal: (v: unknown) => boolean, expected: string): string | undefined {
  if (literal(value)) return undefined;
  if (isRecord(value)) {
    const atKeys = Object.keys(value).filter(key => key.startsWith("@") && key !== "@path" && key !== "@call");
    if (atKeys.length) return `unknown keys ${atKeys.join(", ")}; use "@path" or "@call".`;
    if ("path" in value && !("@path" in value) && !("componentId" in value)) return `use {"@path": "..."} (v1.0), not {"path": ...}.`;
    if (typeof value["@path"] === "string") return Object.keys(value).length === 1 ? undefined : `a binding has only "@path".`;
    if (typeof value["@call"] === "string") return checkCall(value);
  }
  return `expected ${expected}, {"@path": "/..."} or {"@call": ...}.`;
}

function checkCall(value: Record<string, unknown>): string | undefined {
  const name = value["@call"] as string;
  if (name === "@index") return undefined;
  const spec = FUNCTIONS[name];
  if (!spec) return `unknown function "${name}". Available: ${Object.keys(FUNCTIONS).join(", ")}.`;
  const args = value.args;
  if (args !== undefined && !isRecord(args)) return `"${name}".args must be an object.`;
  for (const key of spec.required) if (!isRecord(args) || args[key] === undefined) return `"${name}" needs args.${key}.`;
  for (const key of Object.keys(args || {})) if (!(key in spec.args)) return `"${name}" has no argument "${key}".`;
  if (name === "regex" && typeof (args as Record<string, unknown>).pattern === "string" && ((args as Record<string, unknown>).pattern as string).length > 256) return "regex pattern is longer than 256 characters.";
  return undefined;
}

function checkProp(kind: PropKind, value: unknown): string | undefined {
  switch (kind) {
    case "string": return typeof value === "string" ? undefined : "must be a string.";
    case "number": return typeof value === "number" && Number.isFinite(value) ? undefined : "must be a number.";
    case "integer": return Number.isInteger(value) ? undefined : "must be an integer.";
    case "boolean": return typeof value === "boolean" ? undefined : "must be true or false.";
    case "weight": return typeof value === "number" && value >= 0 ? undefined : "must be a non-negative number.";
    case "dynString": return checkDynamic(value, v => typeof v === "string", "a string");
    case "dynNumber": return checkDynamic(value, v => typeof v === "number", "a number");
    case "dynBoolean": return checkDynamic(value, v => typeof v === "boolean", "a boolean");
    case "dynStringList": return checkDynamic(value, v => Array.isArray(v) && v.every(item => typeof item === "string"), "an array of strings");
    case "dynValue": return checkDynamic(value, v => !isRecord(v), "a value");
    case "child": return typeof value === "string" ? undefined : "must be a component id (string).";
    case "childList":
      if (Array.isArray(value)) return value.every(item => typeof item === "string") ? undefined : "must be an array of component ids.";
      if (isRecord(value) && typeof value.componentId === "string" && typeof value.path === "string") return Object.keys(value).length === 2 ? undefined : "a template has only componentId and path.";
      return `must be an array of ids or a template {"componentId": "...", "path": "/list"}.`;
    case "icon":
      if (typeof value === "string") return (ICON_NAMES as readonly string[]).includes(value) ? undefined : `unknown icon "${value}".`;
      if (isRecord(value) && (typeof value.svgPath === "string" || typeof value["@path"] === "string")) return undefined;
      return "must be an icon name.";
    case "tabs":
      if (!Array.isArray(value) || !value.length) return "must be a non-empty array of {title, child}.";
      return value.every(tab => isRecord(tab) && tab.title !== undefined && typeof tab.child === "string" && !checkDynamic(tab.title, v => typeof v === "string", "a string")) ? undefined : "each tab needs a title and a child id.";
    case "options":
      if (!Array.isArray(value) || !value.length) return "must be a non-empty array of {label, value}.";
      return value.every(option => isRecord(option) && typeof option.value === "string" && option.label !== undefined) ? undefined : "each option needs a label and a string value.";
    case "checks":
      if (!Array.isArray(value)) return "must be an array of {condition, message}.";
      for (const check of value) {
        if (!isRecord(check) || check.condition === undefined) return "each check needs a condition.";
        const problem = checkDynamic(check.condition, () => false, "a function call");
        if (problem) return `check condition: ${problem}`;
      }
      return undefined;
    case "action": {
      if (!isRecord(value)) return `must be {"event": {"name": ...}} or {"functionCall": {...}}.`;
      if (isRecord(value.event)) {
        if (typeof value.event.name !== "string" || !value.event.name) return "event.name is required.";
        if (value.event.context !== undefined && !isRecord(value.event.context)) return "event.context must be an object.";
        if (value.event.userMessage !== undefined) { const problem = checkDynamic(value.event.userMessage, v => typeof v === "string", "a string"); if (problem) return `event.userMessage: ${problem}`; }
        return Object.keys(value).length === 1 ? undefined : "an action has either event or functionCall.";
      }
      if (isRecord(value.functionCall)) {
        if (typeof value.functionCall["@call"] !== "string") return `functionCall needs "@call".`;
        return checkCall(value.functionCall);
      }
      return `must be {"event": {"name": ...}} or {"functionCall": {...}}.`;
    }
    default: return undefined;
  }
}
