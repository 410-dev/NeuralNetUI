import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { AppConfig, ConnectionConfig, ModelConfig, PublicConfig, ReasoningPreset, ToolSettings } from "./types";
import type { AuthUser } from "./auth";
import { updateUserPreferences } from "./auth";
import { dataDir, db } from "./database";
import { inferApiContextWindowTokens } from "./model-context";
import { resolveConnectionModels } from "./connection-drivers";

const presetSchema = z.object({ id: z.string().min(1), name: z.string().min(1), kind: z.enum(["builtin", "custom"]), effort: z.string().optional(), systemPrompt: z.string().optional(), systemPromptMode: z.enum(["replace", "prepend", "append"]).default("append"), ownerId: z.string().optional() });
const modelSchema = z.object({ id: z.string().min(1), name: z.string().min(1), sourceModel: z.string().min(1), description: z.string().optional(), systemPrompt: z.string().optional(), isAlias: z.boolean(), visible: z.boolean().default(true), reasoningSupported: z.boolean(), reasoningEfforts: z.array(z.string()).optional(), reasoningPresets: z.array(presetSchema), contextWindowTokens: z.number().int().positive().optional(), apiContextWindowTokens: z.number().int().positive().optional(), ownerId: z.string().optional(), isPublic: z.boolean().optional(), connectionId: z.string().min(1).optional() });
const connectionSchema = z.object({ id: z.string().min(1), name: z.string().min(1), driver: z.enum(["openai", "lmstudio"]), baseUrl: z.string().url(), apiKey: z.string(), models: z.array(modelSchema).default([]) });

export const DEFAULT_TOOL_SETTINGS: ToolSettings = { maxToolRounds: 8, maxAttachmentsPerMessage: 12, textDownloadLimitMb: 1, textCharacterLimit: 24_000, imageDownloadLimitMb: 10, imageUploadLimitMb: 20, pdfSizeLimitMb: 25, pdfPageLimit: 100, pdfTextCharacterLimit: 100_000, pdfVisionPageLimit: 6, pdfProcessingTimeoutSeconds: 30, temporaryFileTtlMinutes: 60, orphanUploadTtlHours: 24 };
const toolSettingsSchema = z.object({ maxToolRounds: z.number().int().min(1).max(32), maxAttachmentsPerMessage: z.number().int().min(1).max(50), textDownloadLimitMb: z.number().min(0.0625).max(10), textCharacterLimit: z.number().int().min(1_000).max(1_000_000), imageDownloadLimitMb: z.number().min(1).max(50), imageUploadLimitMb: z.number().min(1).max(50), pdfSizeLimitMb: z.number().min(1).max(100), pdfPageLimit: z.number().int().min(1).max(500), pdfTextCharacterLimit: z.number().int().min(1_000).max(1_000_000), pdfVisionPageLimit: z.number().int().min(0).max(20), pdfProcessingTimeoutSeconds: z.number().int().min(5).max(120), temporaryFileTtlMinutes: z.number().int().min(5).max(1_440), orphanUploadTtlHours: z.number().min(1).max(168) }).default(DEFAULT_TOOL_SETTINGS);
const preferencesSchema = z.object({ sendReasoningToModel: z.boolean(), exportReasoning: z.boolean(), language: z.enum(["en", "ko"]).default("en"), onDemand: z.boolean().default(false), showModelIdentifiers: z.boolean().default(true), renderStrikethrough: z.boolean().default(true), defaultModelId: z.string().min(1).optional(), defaultReasoningPresetId: z.string().min(1).optional() }).default({ sendReasoningToModel: false, exportReasoning: true, language: "en", onDemand: false, showModelIdentifiers: true, renderStrikethrough: true });
export const configSchema = z.object({ connections: z.array(connectionSchema).min(1).max(32), profile: z.object({ name: z.string().min(1) }), preferences: preferencesSchema, toolSettings: toolSettingsSchema, models: z.array(modelSchema) });

const defaults: AppConfig = { connections: [{ id: "openai-default", name: "OpenAI API", driver: "openai", baseUrl: "http://localhost:8888/v1", apiKey: "", models: [] }], profile: { name: "User" }, preferences: { sendReasoningToModel: false, exportReasoning: true, language: "en", onDemand: false, showModelIdentifiers: true, renderStrikethrough: true }, toolSettings: DEFAULT_TOOL_SETTINGS, models: [] };
const configPath = path.join(dataDir, "config.json");

function normalizeConfig(config: AppConfig): AppConfig {
  const edited = new Map(config.models.filter((model) => !model.isAlias && model.connectionId).map((model) => [`${model.connectionId}\0${model.id}`, model]));
  const connections = config.connections.map((connection) => ({ ...connection, models: connection.models.filter((model) => !model.isAlias).map((model) => ({ ...model, ...edited.get(`${connection.id}\0${model.id}`), connectionId: connection.id })) }));
  return { ...config, connections, models: resolveConnectionModels(connections, config.models.filter((model) => model.isAlias)) };
}

function migrateConfig(input: unknown): AppConfig {
  const current = configSchema.safeParse(input); if (current.success) return normalizeConfig(current.data);
  const legacy = z.object({ server: z.object({ baseUrl: z.string().url(), apiKey: z.string() }), profile: z.object({ name: z.string().min(1) }), preferences: preferencesSchema, toolSettings: toolSettingsSchema, models: z.array(modelSchema) }).safeParse(input);
  if (!legacy.success) throw current.error;
  const connection: ConnectionConfig = { id: "openai-default", name: "OpenAI API", driver: "openai", ...legacy.data.server, models: legacy.data.models.filter((model) => !model.isAlias).map((model) => ({ ...model, connectionId: "openai-default" })) };
  const aliases = legacy.data.models.filter((model) => model.isAlias).map((model) => ({ ...model, connectionId: "openai-default" }));
  return normalizeConfig({ connections: [connection], profile: legacy.data.profile, preferences: legacy.data.preferences, toolSettings: legacy.data.toolSettings, models: aliases });
}

function claimLegacyCustomizations(config: AppConfig) {
  const owner = db.prepare("SELECT id FROM users WHERE role = 'superadmin' ORDER BY created_at LIMIT 1").get() as { id: string } | undefined;
  if (!owner) return { config, changed: false }; let changed = false;
  for (const model of config.models) { if (model.isAlias && !model.ownerId) { model.ownerId = owner.id; model.isPublic = false; changed = true; } for (const preset of model.reasoningPresets) if (preset.kind === "custom" && !preset.ownerId) { preset.ownerId = owner.id; changed = true; } }
  return { config, changed };
}

async function readLegacyConfig(filePath: string) { try { return migrateConfig(JSON.parse(await fs.readFile(filePath, "utf8"))); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error(`Unable to read legacy config at ${filePath}`, error); } return undefined; }

export async function readConfig(): Promise<AppConfig> {
  const stored = db.prepare("SELECT value FROM app_config WHERE id = 1").get() as { value: string } | undefined;
  if (stored) try { const raw = JSON.parse(stored.value); const claimed = claimLegacyCustomizations(migrateConfig(raw)); if (claimed.changed || !raw.connections) await writeConfig(claimed.config); return claimed.config; } catch (error) { console.error("Invalid SQLite config, recovering from configured defaults", error); }
  return writeConfig(claimLegacyCustomizations((await readLegacyConfig(configPath)) || structuredClone(defaults)).config);
}

export async function writeConfig(input: unknown): Promise<AppConfig> { const parsed = normalizeConfig(configSchema.parse(input)); db.prepare(`INSERT INTO app_config(id, value, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(JSON.stringify(parsed), new Date().toISOString()); return parsed; }
function isAdmin(user: AuthUser) { return user.role === "admin" || user.role === "superadmin"; }
export function canUseModel(model: ModelConfig, user: AuthUser) { return !model.isAlias || !model.ownerId || model.ownerId === user.id || model.isPublic === true; }
function visiblePreset(preset: ReasoningPreset, user: AuthUser) { return preset.kind === "builtin" || !preset.ownerId || preset.ownerId === user.id; }

export function publicConfig(config: AppConfig, user: AuthUser): PublicConfig {
  const preferences: AppConfig["preferences"] = { ...config.preferences, sendReasoningToModel: typeof user.preferences.sendReasoningToModel === "boolean" ? user.preferences.sendReasoningToModel : config.preferences.sendReasoningToModel, exportReasoning: typeof user.preferences.exportReasoning === "boolean" ? user.preferences.exportReasoning : config.preferences.exportReasoning, language: user.preferences.language === "ko" || user.preferences.language === "en" ? user.preferences.language : config.preferences.language, showModelIdentifiers: typeof user.preferences.showModelIdentifiers === "boolean" ? user.preferences.showModelIdentifiers : config.preferences.showModelIdentifiers, renderStrikethrough: typeof user.preferences.renderStrikethrough === "boolean" ? user.preferences.renderStrikethrough : config.preferences.renderStrikethrough, defaultModelId: typeof user.preferences.defaultModelId === "string" ? user.preferences.defaultModelId : config.preferences.defaultModelId, defaultReasoningPresetId: typeof user.preferences.defaultReasoningPresetId === "string" ? user.preferences.defaultReasoningPresetId : config.preferences.defaultReasoningPresetId };
  return { ...config, profile: { name: user.displayName }, preferences, models: config.models.filter((model) => canUseModel(model, user)).map((model) => ({ ...model, reasoningPresets: model.reasoningPresets.filter((preset) => visiblePreset(preset, user)) })), connections: config.connections.map((connection) => ({ ...connection, models: connection.models.map((model) => ({ ...model, reasoningPresets: model.reasoningPresets.filter((preset) => visiblePreset(preset, user)) })), apiKey: "", hasApiKey: Boolean(connection.apiKey || (connection.driver === "openai" && process.env.OPENAI_API_KEY)) })), account: { id: user.id, username: user.username, displayName: user.displayName, role: user.role } };
}

export async function writeConfigForUser(input: unknown, user: AuthUser): Promise<AppConfig> {
  const incoming = normalizeConfig(configSchema.parse(input)); const current = await readConfig(); const admin = isAdmin(user);
  updateUserPreferences(user.id, admin ? incoming.profile.name : user.displayName, { sendReasoningToModel: incoming.preferences.sendReasoningToModel, exportReasoning: incoming.preferences.exportReasoning, language: incoming.preferences.language, showModelIdentifiers: incoming.preferences.showModelIdentifiers, renderStrikethrough: incoming.preferences.renderStrikethrough, defaultModelId: incoming.preferences.defaultModelId, defaultReasoningPresetId: incoming.preferences.defaultReasoningPresetId });
  const mergePrivatePresets = (existing: ModelConfig, candidate?: ModelConfig) => {
    if (!candidate) return existing;
    const protectedPresets = existing.reasoningPresets.filter((preset) => preset.kind === "custom" && preset.ownerId && preset.ownerId !== user.id);
    const editablePresets = candidate.reasoningPresets.filter((preset) => preset.kind === "builtin" ? admin : !preset.ownerId || preset.ownerId === user.id).map((preset) => preset.kind === "custom" ? { ...preset, ownerId: user.id } : preset);
    return { ...(admin ? candidate : existing), reasoningPresets: [...editablePresets, ...protectedPresets.filter((preset) => !editablePresets.some((item) => item.id === preset.id))] };
  };
  const incomingConnections = new Map(incoming.connections.map((connection) => [connection.id, connection]));
  if (!admin) {
    const connections = current.connections.map((connection) => { const candidate = incomingConnections.get(connection.id); return { ...connection, models: connection.models.map((model) => mergePrivatePresets(model, candidate?.models.find((item) => item.id === model.id))) }; });
    const aliases = current.models.filter((model) => model.isAlias && model.ownerId !== user.id).concat(incoming.models.filter((model) => model.isAlias && (!model.ownerId || model.ownerId === user.id)).map((model) => ({ ...model, ownerId: user.id })));
    return writeConfig({ ...current, connections, models: aliases });
  }
  const existing = new Map(current.connections.map((connection) => [connection.id, connection]));
  const connections = incoming.connections.map((connection) => { const previous = existing.get(connection.id); return { ...connection, apiKey: connection.apiKey || previous?.apiKey || "", models: connection.models.map((model) => mergePrivatePresets(previous?.models.find((item) => item.id === model.id) || model, model)) }; });
  const incomingAliases = incoming.models.filter((model) => model.isAlias).map((model) => { const previous = current.models.find((item) => item.isAlias && item.id === model.id); return mergePrivatePresets(previous || model, { ...model, ownerId: previous?.ownerId || user.id }); });
  const protectedAliases = current.models.filter((model) => model.isAlias && model.ownerId && model.ownerId !== user.id && !incomingAliases.some((candidate) => candidate.id === model.id));
  return writeConfig({ ...incoming, connections, models: [...incomingAliases, ...protectedAliases], profile: current.profile, preferences: { ...current.preferences, ...incoming.preferences } });
}

export function inferModel(input: string | Record<string, unknown>, driver: "openai" | "lmstudio" = "openai", connectionId?: string): ModelConfig {
  const record = typeof input === "string" ? {} : input; const modelId = typeof input === "string" ? input : String(record.key || record.id || ""); const id = modelId.toLowerCase();
  const capabilities = typeof record.capabilities === "object" && record.capabilities ? record.capabilities as Record<string, unknown> : {}; const reasoning = typeof capabilities.reasoning === "object" && capabilities.reasoning ? capabilities.reasoning as Record<string, unknown> : {};
  const advertised = record.reasoning_efforts || record.supported_reasoning_efforts || reasoning.allowed_options || capabilities.reasoning_efforts; const knownQwen = /qwen3\.8/i.test(modelId); const efforts = Array.isArray(advertised) ? advertised.map(String) : knownQwen ? ["none", "low", "medium", "high", "xhigh"] : [];
  const reasoningSupported = Boolean(record.reasoning_supported ?? (typeof capabilities.reasoning === "boolean" ? capabilities.reasoning : Object.keys(reasoning).length) ?? efforts.length) || /(reason|o1|o3|o4|gpt-5|qwen3|deepseek-r1|thinking)/i.test(id);
  const knownGemma = /gemma4.*31b/i.test(modelId);
  const friendlyName = typeof record.display_name === "string" ? record.display_name : knownQwen ? "Qwen3.8 27B" : knownGemma ? "Gemma 4 31B" : modelId.split(/[\/_-]/).filter(Boolean).slice(-2).join(" ").replace(/\b\w/g, (c) => c.toUpperCase());
  const sourceModel = driver === "openai" && knownQwen && /esatapedico/i.test(modelId) ? `${modelId}:Qwen3.8-27B-NVFP4-MTP-HIGH` : driver === "openai" && knownGemma && record.quant ? `${modelId}:${String(record.quant)}` : modelId;
  const normalizedEfforts = efforts.length ? efforts : reasoningSupported ? ["low", "medium", "high"] : [];
  return { id: modelId, name: friendlyName, sourceModel, description: `Language model from ${driver === "lmstudio" ? "LM Studio" : "OpenAI API"}`, isAlias: false, visible: true, reasoningSupported, reasoningEfforts: normalizedEfforts, apiContextWindowTokens: inferApiContextWindowTokens(record), connectionId, reasoningPresets: normalizedEfforts.length ? normalizedEfforts.map((effort) => ({ id: effort.replaceAll("_", "-"), name: effort === "xhigh" ? "Extra High" : effort.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase()), kind: "builtin" as const, effort })) : [{ id: "default", name: "Default", kind: "custom" as const }] };
}
