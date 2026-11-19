import { BUILTIN_TOOL_PROVIDERS, builtinToolProvider, mcpProviderId, type ToolOptions, type ToolProviderManifest } from "./catalog.ts";

/**
 * Which tool providers an account (or one chat request) has switched on. Shared by the server and the browser.
 *
 * Providers with no entry follow their manifest default, so a newly shipped tool needs no migration. Entries for
 * providers that are unknown right now (a disabled MCP connection, a plugin that is temporarily unavailable) are
 * kept rather than dropped, so a save made while they are hidden does not lose them.
 */
export interface ToolProviderState {
  enabled: boolean;
  options?: ToolOptions;
  /** Per-chat allow-list of the provider's own function names. Missing means every function it offers. */
  functions?: string[];
}

export interface ToolState { version: 2; providers: Record<string, ToolProviderState> }

const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,63}(:[A-Za-z0-9_-]{1,100})?$/;
const MAX_PROVIDERS = 256, MAX_OPTIONS = 32, MAX_FUNCTIONS = 256;

export const isToolProviderId = (value: string) => PROVIDER_ID.test(value);

/** Every built-in provider at its default, which is what an account that never changed a switch gets. */
export const DEFAULT_TOOL_STATE: ToolState = Object.freeze({ version: 2, providers: {} }) as ToolState;

const record = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

function normalizeFunctions(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 200))].slice(0, MAX_FUNCTIONS);
}

/** Options checked against the manifest's fields; providers without a known manifest keep plain scalar values. */
export function normalizeToolOptions(manifest: Pick<ToolProviderManifest, "options"> | undefined, value: unknown): ToolOptions {
  const source = record(value) || {};
  if (!manifest?.options) {
    return Object.fromEntries(Object.entries(source).slice(0, MAX_OPTIONS).filter((entry): entry is [string, boolean | number] =>
      entry[0].length <= 64 && (typeof entry[1] === "boolean" || typeof entry[1] === "number" && Number.isFinite(entry[1]))));
  }
  return Object.fromEntries(manifest.options.map(field => {
    const raw = source[field.key];
    if (field.kind === "boolean") return [field.key, typeof raw === "boolean" ? raw : field.default];
    const number = Math.floor(Number(raw));
    return [field.key, Number.isFinite(number) && raw !== null && raw !== "" ? Math.max(field.min, Math.min(field.max, number)) : field.default];
  }));
}

function normalizeProvider(id: string, value: unknown): ToolProviderState | undefined {
  const source = record(value);
  if (!source || typeof source.enabled !== "boolean") return undefined;
  const manifest = builtinToolProvider(id);
  const options = source.options === undefined && !manifest?.options ? undefined : normalizeToolOptions(manifest, source.options);
  const functions = normalizeFunctions(source.functions);
  return { enabled: source.enabled, ...(options && Object.keys(options).length ? { options } : {}), ...(functions ? { functions } : {}) };
}

/** The account preference and chat request format before tool providers existed. */
const LEGACY_SWITCHES: Record<string, string> = {
  internetSearch: "web-search", pageVisit: "page-visit", currentTime: "current-time",
  location: "location", multipleChoice: "multiple-choice", artifact: "artifact",
};
const LEGACY_KEYS = [...Object.keys(LEGACY_SWITCHES), "storageAccess", "storageRead", "storageWrite", "storageWriteMaxFiles", "mcpConnectionIds", "mcpToolNames"];

export function isLegacyToolState(value: unknown) {
  const source = record(value);
  return Boolean(source && source.version !== 2 && LEGACY_KEYS.some(key => key in source));
}

/**
 * Saved preferences leave out switches that follow the defaults. Chat requests in this format always meant "only what
 * is true", so `strict` turns every switch the request did not set to off.
 */
function fromLegacy(source: Record<string, unknown>, strict = false): ToolState {
  const providers: Record<string, ToolProviderState> = {};
  for (const [key, id] of Object.entries(LEGACY_SWITCHES)) if (typeof source[key] === "boolean" || strict) providers[id] = { enabled: source[key] === true };
  if (strict || ["storageAccess", "storageRead", "storageWrite", "storageWriteMaxFiles"].some(key => key in source)) {
    const storage = builtinToolProvider("storage")!;
    const flag = (value: unknown) => strict ? value === true : value;
    providers.storage = {
      enabled: typeof source.storageAccess === "boolean" ? source.storageAccess : !strict && storage.defaultEnabled,
      options: normalizeToolOptions(storage, { read: flag(source.storageRead), write: flag(source.storageWrite), maxFiles: source.storageWriteMaxFiles }),
    };
  }
  const connections = Array.isArray(source.mcpConnectionIds) ? source.mcpConnectionIds.filter((id): id is string => typeof id === "string") : [];
  const selections = record(source.mcpToolNames) || {};
  for (const connectionId of new Set([...connections, ...Object.keys(selections)])) {
    const id = mcpProviderId(connectionId);
    if (!isToolProviderId(id)) continue;
    const functions = normalizeFunctions(selections[connectionId]);
    providers[id] = { enabled: connections.includes(connectionId), ...(functions ? { functions } : {}) };
  }
  return { version: 2, providers };
}

/** Accepts the current format, the legacy switch format, or anything else (which yields the defaults). */
export function normalizeToolState(input: unknown): ToolState {
  const source = record(input);
  if (!source) return { version: 2, providers: {} };
  if (isLegacyToolState(source)) return fromLegacy(source);
  const providers: Record<string, ToolProviderState> = {};
  for (const [id, value] of Object.entries(record(source.providers) || {})) {
    if (Object.keys(providers).length >= MAX_PROVIDERS) break;
    if (!isToolProviderId(id)) continue;
    const normalized = normalizeProvider(id, value);
    if (normalized) providers[id] = normalized;
  }
  return { version: 2, providers };
}

/** Applies a partial change, provider by provider. A provider entry in the patch replaces only the fields it names. */
export function mergeToolState(base: ToolState, patch: unknown): ToolState {
  const incoming = normalizeToolState(patch);
  const rawProviders = record(record(patch)?.providers) || {};
  const providers = { ...base.providers };
  for (const [id, value] of Object.entries(incoming.providers)) {
    const raw = record(rawProviders[id]) || {};
    const previous = providers[id];
    providers[id] = {
      ...previous, ...value,
      ...(raw.options === undefined && previous?.options ? { options: previous.options } : {}),
      ...(raw.functions === undefined && previous?.functions ? { functions: previous.functions } : {}),
    };
  }
  return normalizeToolState({ version: 2, providers });
}

/** Account preferences keep switches and options; function selections belong to one chat and are not saved. */
export function persistableToolState(state: ToolState): ToolState {
  return { version: 2, providers: Object.fromEntries(Object.entries(state.providers).map(([id, { functions: _functions, ...rest }]) => [id, rest])) };
}

/** A provider's effective switch and options for this state. */
export function resolveProviderState(state: ToolState, manifest: Pick<ToolProviderManifest, "id" | "defaultEnabled" | "options">) {
  const entry = state.providers[manifest.id];
  return {
    enabled: entry?.enabled ?? manifest.defaultEnabled,
    options: normalizeToolOptions(manifest, entry?.options),
    functions: entry?.functions,
  };
}

export function setProviderEnabled(state: ToolState, id: string, enabled: boolean): ToolState {
  return { version: 2, providers: { ...state.providers, [id]: { ...state.providers[id], enabled } } };
}

export function setProviderOption(state: ToolState, manifest: ToolProviderManifest, key: string, value: boolean | number): ToolState {
  const current = resolveProviderState(state, manifest);
  const options = normalizeToolOptions(manifest, { ...current.options, [key]: value });
  return { version: 2, providers: { ...state.providers, [manifest.id]: { ...state.providers[manifest.id], enabled: current.enabled, options } } };
}

export function setProviderFunctions(state: ToolState, id: string, functions: string[] | undefined, defaultEnabled = false): ToolState {
  const previous = state.providers[id];
  const { functions: _old, ...rest } = previous || { enabled: defaultEnabled };
  return { version: 2, providers: { ...state.providers, [id]: functions ? { ...rest, functions: normalizeFunctions(functions) } : rest } };
}

/** Count of switched-on providers among those offered, for the composer badge. */
export function enabledProviderCount(state: ToolState, manifests: readonly Pick<ToolProviderManifest, "id" | "defaultEnabled" | "options">[]) {
  return manifests.filter(manifest => resolveProviderState(state, manifest).enabled).length;
}

/** Drops every per-chat function selection, as when another chat is opened. */
export function clearFunctionSelections(state: ToolState): ToolState {
  if (!Object.values(state.providers).some(entry => entry.functions)) return state;
  return persistableToolState(state);
}

/**
 * The tool state of one chat request. Only the provider format (`version: 2`) uses manifest defaults; a request in the
 * older switch format, or one without tools, keeps every built-in tool it did not switch on turned off, as before.
 */
export function requestToolState(input: unknown): ToolState {
  const source = record(input);
  if (source?.version === 2) return normalizeToolState(source);
  if (source && isLegacyToolState(source)) return fromLegacy(source, true);
  return { version: 2, providers: Object.fromEntries(BUILTIN_TOOL_PROVIDERS.map(manifest => [manifest.id, { enabled: false }])) };
}
