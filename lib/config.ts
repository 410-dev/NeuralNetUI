import { DEFAULT_APPEARANCE, DEFAULT_LOGIN_APPEARANCE, normalizeAppearance, normalizeLoginAppearance } from "./appearance";
import { DEFAULT_HARNESS_SETTINGS } from "./harness";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { AppConfig, ConnectionConfig, ExperimentalFeatures, ModelConfig, PublicConfig, ReasoningPreset, ToolSettings } from "./types";
import type { AuthUser } from "./auth";
import { overwriteUserPreference, updateUserPreferences } from "./auth";
import { dataDir, db } from "./database";
import { inferApiContextWindowTokens } from "./model-context";
import { mergeModelPresets } from "./model-edits";
import { inferReasoning, normalizeReasoning } from "./reasoning-capabilities";
import { resolveConnectionModels } from "./connection-drivers";
import { isHostComputerAvailable } from "./host-environment";

const presetSchema = z.object({ id: z.string().min(1), name: z.string().min(1), kind: z.enum(["builtin", "custom"]), effort: z.string().optional(), systemPrompt: z.string().optional(), systemPromptMode: z.enum(["replace", "prepend", "append"]).default("append"), ownerId: z.string().optional() });
const modelSchema = z.object({ id: z.string().min(1), name: z.string().min(1), sourceModel: z.string().min(1), description: z.string().optional(), systemPrompt: z.string().optional(), isAlias: z.boolean(), visible: z.boolean().default(true), reasoningSupported: z.boolean(), reasoningEfforts: z.array(z.string()).optional(), reasoningPresets: z.array(presetSchema), contextWindowTokens: z.number().int().positive().optional(), apiContextWindowTokens: z.number().int().positive().optional(), ownerId: z.string().optional(), isPublic: z.boolean().optional(), connectionId: z.string().min(1).optional() });
const connectionSchema = z.object({ id: z.string().min(1), name: z.string().min(1), driver: z.enum(["openai", "lmstudio"]), baseUrl: z.string().url(), apiKey: z.string(), clearApiKey: z.boolean().optional(), maxResidentModels: z.number().int().min(0).max(128).default(0), modelWaitPolicy: z.enum(["capacity", "serial"]).default("capacity"), models: z.array(modelSchema).default([]) });

export const DEFAULT_EXPERIMENTAL: Required<ExperimentalFeatures> = { browserTool: false, openAIProgress: false, hostComputerTool: false };
export const DEFAULT_TOOL_SETTINGS: ToolSettings = { maxToolRounds: 8, maxBrowserTabs: 8, maxMultipleChoiceQuestions: 3, maxAttachmentsPerMessage: 12, textDownloadLimitMb: 1, textCharacterLimit: 24_000, imageDownloadLimitMb: 10, imageUploadLimitMb: 20, pdfSizeLimitMb: 25, pdfPageLimit: 100, pdfTextCharacterLimit: 100_000, pdfVisionPageLimit: 6, pdfProcessingTimeoutSeconds: 30, temporaryFileTtlMinutes: 60, orphanUploadTtlHours: 24 };
const toolSettingsSchema = z.object({ maxToolRounds: z.number().int().min(1).max(32), maxBrowserTabs: z.number().int().min(1).max(20).default(DEFAULT_TOOL_SETTINGS.maxBrowserTabs), maxMultipleChoiceQuestions: z.number().int().min(1).max(10).default(DEFAULT_TOOL_SETTINGS.maxMultipleChoiceQuestions), maxAttachmentsPerMessage: z.number().int().min(1).max(50), textDownloadLimitMb: z.number().min(0.0625).max(10), textCharacterLimit: z.number().int().min(1_000).max(1_000_000), imageDownloadLimitMb: z.number().min(1).max(50), imageUploadLimitMb: z.number().min(1).max(50), pdfSizeLimitMb: z.number().min(1).max(100), pdfPageLimit: z.number().int().min(1).max(500), pdfTextCharacterLimit: z.number().int().min(1_000).max(1_000_000), pdfVisionPageLimit: z.number().int().min(0).max(20), pdfProcessingTimeoutSeconds: z.number().int().min(5).max(120), temporaryFileTtlMinutes: z.number().int().min(5).max(1_440), orphanUploadTtlHours: z.number().min(1).max(168) }).default(DEFAULT_TOOL_SETTINGS);
const appearanceSchema = z.object({
  lmStudioProgress: z.enum(["text", "percent", "donut", "both"]).default("both"),
  accentPalette: z.enum(["blue", "violet", "teal", "amber", "rose", "graphite", "custom"]).default("blue"),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default(DEFAULT_APPEARANCE.accentColor),
  streamReveal: z.enum(["instant", "fade"]).default("instant"),
  streamPacing: z.enum(["immediate", "chunked"]).default("immediate"),
  streamChunkSize: z.number().int().min(1).max(24).default(DEFAULT_APPEARANCE.streamChunkSize),
  showReasoningNotes: z.boolean().default(true),
  greetings: z.object({
    ko: z.partialRecord(z.enum(["earlyDawn", "morning", "midday", "afternoon", "evening", "night", "lateNight"]), z.array(z.string().max(200)).max(5)).optional(),
    en: z.partialRecord(z.enum(["earlyDawn", "morning", "midday", "afternoon", "evening", "night", "lateNight"]), z.array(z.string().max(200)).max(5)).optional(),
  }).default({}),
  reasoningNotes: z.record(z.string(), z.string().max(200)).default({}),
}).default(DEFAULT_APPEARANCE);
const preferencesSchema = z.object({ sendReasoningToModel: z.boolean(), exportReasoning: z.boolean(), language: z.enum(["en", "ko"]).default("en"), onDemand: z.boolean().default(false), showModelIdentifiers: z.boolean().default(true), renderStrikethrough: z.boolean().default(true), defaultModelId: z.string().min(1).optional(), defaultReasoningPresetId: z.string().min(1).optional(), appearance: appearanceSchema }).default({ sendReasoningToModel: false, exportReasoning: true, language: "en", onDemand: false, showModelIdentifiers: true, renderStrikethrough: true, appearance: DEFAULT_APPEARANCE });
const harnessSettingsSchema = z.object({
  contextMode: z.enum(["rolling", "compacting"]), maxOutputTokens: z.number().int().min(0).max(1_000_000).default(0),
  resumePrompt: z.string().trim().min(1).max(32000).default(DEFAULT_HARNESS_SETTINGS.resumePrompt),
  maxCompactionResumes: z.number().int().min(0).max(100).default(DEFAULT_HARNESS_SETTINGS.maxCompactionResumes),
  compactThreshold: z.number().int().min(10).max(95),
  compactModelId: z.string().max(500), compactEffort: z.string().max(40), compactPrompt: z.string().trim().min(1).max(32000),
  titleEnabled: z.boolean(), titleTiming: z.enum(["before", "after"]), titleModelId: z.string().max(500),
  titleEffort: z.string().max(40), titlePrompt: z.string().trim().min(1).max(32000),
  hostTrustMode: z.enum(["full", "partial", "none"]).default(DEFAULT_HARNESS_SETTINGS.hostTrustMode),
  hostTrustedRiskLevels: z.array(z.boolean()).length(5).default(DEFAULT_HARNESS_SETTINGS.hostTrustedRiskLevels),
  hostCommandModelId: z.string().max(500).default(DEFAULT_HARNESS_SETTINGS.hostCommandModelId),
  hostCommandEffort: z.string().max(40).default(DEFAULT_HARNESS_SETTINGS.hostCommandEffort),
  hostCommandAnalysisPrompt: z.string().trim().min(1).max(32000).default(DEFAULT_HARNESS_SETTINGS.hostCommandAnalysisPrompt),
}).default(DEFAULT_HARNESS_SETTINGS);
const experimentalSchema = z.object({ browserTool: z.boolean().default(false), openAIProgress: z.boolean().default(false), hostComputerTool: z.boolean().default(false) }).default(DEFAULT_EXPERIMENTAL);
const loginAppearanceSchema = z.object({
  accentPalette: z.enum(["blue", "violet", "teal", "amber", "rose", "graphite", "custom"]).default(DEFAULT_LOGIN_APPEARANCE.accentPalette),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default(DEFAULT_LOGIN_APPEARANCE.accentColor),
}).default(DEFAULT_LOGIN_APPEARANCE);
export const configSchema = z.object({ connections: z.array(connectionSchema).min(1).max(32), profile: z.object({ name: z.string().min(1) }), preferences: preferencesSchema, loginAppearance: loginAppearanceSchema, toolSettings: toolSettingsSchema, harnessSettings: harnessSettingsSchema, experimental: experimentalSchema, models: z.array(modelSchema) });

const defaults: AppConfig = { connections: [{ id: "openai-default", name: "OpenAI API", driver: "openai", baseUrl: "http://localhost:8888/v1", apiKey: "", models: [] }], profile: { name: "User" }, preferences: { sendReasoningToModel: false, exportReasoning: true, language: "en", onDemand: false, showModelIdentifiers: true, renderStrikethrough: true, appearance: DEFAULT_APPEARANCE }, loginAppearance: DEFAULT_LOGIN_APPEARANCE, toolSettings: DEFAULT_TOOL_SETTINGS, experimental: DEFAULT_EXPERIMENTAL, models: [] };
const configPath = path.join(dataDir, "config.json");

function normalizeConfig(config: AppConfig): AppConfig {
  const edited = new Map(config.models.filter((model) => !model.isAlias && model.connectionId).map((model) => [`${model.connectionId}\0${model.id}`, model]));
  const connections = config.connections.map((connection) => ({ ...connection, models: connection.models.filter((model) => !model.isAlias).map((model) => normalizeReasoning({ ...model, ...edited.get(`${connection.id}\0${model.id}`), connectionId: connection.id })) }));
  return { ...config, connections, models: resolveConnectionModels(connections, config.models.filter((model) => model.isAlias), config.models.map((model) => model.id)) };
}

function migrateConfig(input: unknown): AppConfig {
  const current = configSchema.safeParse(input); if (current.success) return normalizeConfig(current.data);
  const legacy = z.object({ server: z.object({ baseUrl: z.string().url(), apiKey: z.string() }), profile: z.object({ name: z.string().min(1) }), preferences: preferencesSchema, toolSettings: toolSettingsSchema, harnessSettings: harnessSettingsSchema, models: z.array(modelSchema) }).safeParse(input);
  if (!legacy.success) throw current.error;
  const connection: ConnectionConfig = { id: "openai-default", name: "OpenAI API", driver: "openai", ...legacy.data.server, models: legacy.data.models.filter((model) => !model.isAlias).map((model) => ({ ...model, connectionId: "openai-default" })) };
  const aliases = legacy.data.models.filter((model) => model.isAlias).map((model) => ({ ...model, connectionId: "openai-default" }));
  return normalizeConfig({ connections: [connection], profile: legacy.data.profile, preferences: legacy.data.preferences, loginAppearance: DEFAULT_LOGIN_APPEARANCE, toolSettings: legacy.data.toolSettings, experimental: DEFAULT_EXPERIMENTAL, models: aliases });
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
  const preferences: AppConfig["preferences"] = { ...config.preferences, sendReasoningToModel: typeof user.preferences.sendReasoningToModel === "boolean" ? user.preferences.sendReasoningToModel : config.preferences.sendReasoningToModel, exportReasoning: typeof user.preferences.exportReasoning === "boolean" ? user.preferences.exportReasoning : config.preferences.exportReasoning, language: user.preferences.language === "ko" || user.preferences.language === "en" ? user.preferences.language : config.preferences.language, showModelIdentifiers: typeof user.preferences.showModelIdentifiers === "boolean" ? user.preferences.showModelIdentifiers : config.preferences.showModelIdentifiers, renderStrikethrough: typeof user.preferences.renderStrikethrough === "boolean" ? user.preferences.renderStrikethrough : config.preferences.renderStrikethrough, defaultModelId: typeof user.preferences.defaultModelId === "string" ? user.preferences.defaultModelId : config.preferences.defaultModelId, defaultReasoningPresetId: typeof user.preferences.defaultReasoningPresetId === "string" ? user.preferences.defaultReasoningPresetId : config.preferences.defaultReasoningPresetId, appearance: normalizeAppearance((user.preferences.appearance as Partial<typeof DEFAULT_APPEARANCE>) || config.preferences.appearance) };
  const superadmin = user.role === "superadmin";
  const harnessSettings = superadmin ? config.harnessSettings : { ...(config.harnessSettings || DEFAULT_HARNESS_SETTINGS), ...{
    hostTrustMode: DEFAULT_HARNESS_SETTINGS.hostTrustMode,
    hostTrustedRiskLevels: DEFAULT_HARNESS_SETTINGS.hostTrustedRiskLevels,
    hostCommandModelId: "", hostCommandEffort: "off", hostCommandAnalysisPrompt: DEFAULT_HARNESS_SETTINGS.hostCommandAnalysisPrompt,
  } };
  return { ...config, harnessSettings, experimental: { ...config.experimental, hostComputerTool: superadmin && config.experimental.hostComputerTool }, hostComputerAvailable: superadmin && isHostComputerAvailable(), loginAppearance: normalizeLoginAppearance(config.loginAppearance), profile: { name: user.displayName }, preferences, models: config.models.filter((model) => canUseModel(model, user)).map((model) => ({ ...model, reasoningPresets: model.reasoningPresets.filter((preset) => visiblePreset(preset, user)) })), connections: config.connections.map((connection) => ({ ...connection, models: connection.models.map((model) => ({ ...model, reasoningPresets: model.reasoningPresets.filter((preset) => visiblePreset(preset, user)) })), apiKey: "", hasApiKey: Boolean(!connection.clearApiKey && (connection.apiKey || (connection.driver === "openai" && process.env.OPENAI_API_KEY))) })), account: { id: user.id, username: user.username, displayName: user.displayName, role: user.role } };
}

export async function writeConfigForUser(input: unknown, user: AuthUser): Promise<AppConfig> {
  const incoming = normalizeConfig(configSchema.parse(input)); const current = await readConfig(); const admin = isAdmin(user);
  updateUserPreferences(user.id, incoming.profile.name, { sendReasoningToModel: incoming.preferences.sendReasoningToModel, exportReasoning: incoming.preferences.exportReasoning, language: incoming.preferences.language, showModelIdentifiers: incoming.preferences.showModelIdentifiers, renderStrikethrough: incoming.preferences.renderStrikethrough, defaultModelId: incoming.preferences.defaultModelId, defaultReasoningPresetId: incoming.preferences.defaultReasoningPresetId, appearance: incoming.preferences.appearance });
  const mergePrivatePresets = (existing: ModelConfig, candidate?: ModelConfig) => mergeModelPresets(existing, candidate, user.id, admin);
  if (!admin) {
    // Served models, including their reasoning templates, are an administrator's to shape. A
    // standard account only owns its aliases, so everything else is carried over untouched.
    const aliases = current.models.filter((model) => model.isAlias && model.ownerId !== user.id).concat(incoming.models.filter((model) => model.isAlias && (!model.ownerId || model.ownerId === user.id)).map((model) => ({ ...model, ownerId: user.id })));
    return writeConfig({ ...current, models: aliases });
  }
  const existing = new Map(current.connections.map((connection) => [connection.id, connection]));
  const connections = incoming.connections.map((connection) => { const previous = existing.get(connection.id); return { ...connection, apiKey: connection.clearApiKey ? "" : connection.apiKey || previous?.apiKey || "", models: connection.models.map((model) => mergePrivatePresets(previous?.models.find((item) => item.id === model.id) || model, model)) }; });
  const incomingAliases = incoming.models.filter((model) => model.isAlias).map((model) => { const previous = current.models.find((item) => item.isAlias && item.id === model.id); return mergePrivatePresets(previous || model, { ...model, ownerId: previous?.ownerId || user.id }); });
  const protectedAliases = current.models.filter((model) => model.isAlias && model.ownerId && model.ownerId !== user.id && !incomingAliases.some((candidate) => candidate.id === model.id));
  const aliasesById = new Map(incomingAliases.map((model) => [model.id, model]));
  const orderedIncoming = incoming.models.map((model) => model.isAlias ? aliasesById.get(model.id) : connections.find(c => c.id === model.connectionId)?.models.find(m => m.id === model.id)).filter((model): model is ModelConfig => Boolean(model));
  const hostProtected = user.role === "superadmin" ? incoming : {
    ...incoming,
    experimental: { ...incoming.experimental, hostComputerTool: current.experimental.hostComputerTool },
    harnessSettings: { ...(incoming.harnessSettings || DEFAULT_HARNESS_SETTINGS),
      hostTrustMode: (current.harnessSettings || DEFAULT_HARNESS_SETTINGS).hostTrustMode,
      hostTrustedRiskLevels: (current.harnessSettings || DEFAULT_HARNESS_SETTINGS).hostTrustedRiskLevels,
      hostCommandModelId: (current.harnessSettings || DEFAULT_HARNESS_SETTINGS).hostCommandModelId,
      hostCommandEffort: (current.harnessSettings || DEFAULT_HARNESS_SETTINGS).hostCommandEffort,
      hostCommandAnalysisPrompt: (current.harnessSettings || DEFAULT_HARNESS_SETTINGS).hostCommandAnalysisPrompt,
    },
  };
  return writeConfig({ ...hostProtected, connections, models: [...orderedIncoming, ...protectedAliases], profile: current.profile, preferences: { ...current.preferences, ...incoming.preferences } });
}

/**
 * Makes one choice the workspace default and stamps it onto every account, replacing only that
 * key so a person's other saved preferences survive the change.
 */
export async function applyGlobalDefault(kind: "model" | "reasoning", id: string): Promise<AppConfig> {
  const key = kind === "model" ? "defaultModelId" : "defaultReasoningPresetId";
  const current = await readConfig();
  const saved = await writeConfig({ ...current, preferences: { ...current.preferences, [key]: id } });
  overwriteUserPreference(key, id);
  return saved;
}

export function inferModel(input: string | Record<string, unknown>, driver: "openai" | "lmstudio" = "openai", connectionId?: string): ModelConfig {
  const record = typeof input === "string" ? {} : input; const modelId = typeof input === "string" ? input : String(record.key || record.id || ""); const id = modelId.toLowerCase();
  const knownQwen = /qwen3\.8/i.test(modelId);
  const capability = inferReasoning(record, modelId, driver);
  const knownGemma = /gemma4.*31b/i.test(modelId);
  const friendlyName = typeof record.display_name === "string" ? record.display_name : knownQwen ? "Qwen3.8 27B" : knownGemma ? "Gemma 4 31B" : modelId.split(/[\/_-]/).filter(Boolean).slice(-2).join(" ").replace(/\b\w/g, (c) => c.toUpperCase());
  const sourceModel = driver === "openai" && knownQwen && /esatapedico/i.test(modelId) ? `${modelId}:Qwen3.8-27B-NVFP4-MTP-HIGH` : driver === "openai" && knownGemma && record.quant ? `${modelId}:${String(record.quant)}` : modelId;
  return normalizeReasoning({ id: modelId, name: friendlyName, sourceModel, description: `Language model from ${driver === "lmstudio" ? "LM Studio" : "OpenAI API"}`, isAlias: false, visible: true, ...capability, apiContextWindowTokens: inferApiContextWindowTokens(record), connectionId, reasoningPresets: [] });
}
