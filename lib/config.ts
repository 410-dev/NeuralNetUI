import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { AppConfig, ModelConfig, PublicConfig, ReasoningPreset, ToolSettings } from "./types";
import type { AuthUser } from "./auth";
import { updateUserPreferences } from "./auth";
import { dataDir, db } from "./database";
import { inferApiContextWindowTokens } from "./model-context";

const presetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["builtin", "custom"]),
  effort: z.string().optional(),
  systemPrompt: z.string().optional(),
  systemPromptMode: z.enum(["replace", "prepend", "append"]).default("append"),
  ownerId: z.string().optional(),
});

const modelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  sourceModel: z.string().min(1),
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  isAlias: z.boolean(),
  visible: z.boolean().default(true),
  reasoningSupported: z.boolean(),
  reasoningEfforts: z.array(z.string()).optional(),
  reasoningPresets: z.array(presetSchema),
  contextWindowTokens: z.number().int().positive().optional(),
  apiContextWindowTokens: z.number().int().positive().optional(),
  ownerId: z.string().optional(),
  isPublic: z.boolean().optional(),
});

export const DEFAULT_TOOL_SETTINGS: ToolSettings = {
  maxToolRounds: 8,
  maxAttachmentsPerMessage: 12,
  textDownloadLimitMb: 1,
  textCharacterLimit: 24_000,
  imageDownloadLimitMb: 10,
  imageUploadLimitMb: 20,
  pdfSizeLimitMb: 25,
  pdfPageLimit: 100,
  pdfTextCharacterLimit: 100_000,
  pdfVisionPageLimit: 6,
  pdfProcessingTimeoutSeconds: 30,
  temporaryFileTtlMinutes: 60,
  orphanUploadTtlHours: 24,
};

const toolSettingsSchema = z.object({
  maxToolRounds: z.number().int().min(1).max(32),
  maxAttachmentsPerMessage: z.number().int().min(1).max(50),
  textDownloadLimitMb: z.number().min(0.0625).max(10),
  textCharacterLimit: z.number().int().min(1_000).max(1_000_000),
  imageDownloadLimitMb: z.number().min(1).max(50),
  imageUploadLimitMb: z.number().min(1).max(50),
  pdfSizeLimitMb: z.number().min(1).max(100),
  pdfPageLimit: z.number().int().min(1).max(500),
  pdfTextCharacterLimit: z.number().int().min(1_000).max(1_000_000),
  pdfVisionPageLimit: z.number().int().min(0).max(20),
  pdfProcessingTimeoutSeconds: z.number().int().min(5).max(120),
  temporaryFileTtlMinutes: z.number().int().min(5).max(1_440),
  orphanUploadTtlHours: z.number().min(1).max(168),
}).default(DEFAULT_TOOL_SETTINGS);

export const configSchema = z.object({
  server: z.object({
    baseUrl: z.string().url(),
    apiKey: z.string(),
  }),
  profile: z.object({ name: z.string().min(1) }),
  preferences: z.object({
    sendReasoningToModel: z.boolean(),
    exportReasoning: z.boolean(),
    language: z.enum(["en", "ko"]).default("en"),
    onDemand: z.boolean().default(false),
    showModelIdentifiers: z.boolean().default(true),
  }).default({ sendReasoningToModel: false, exportReasoning: true, language: "en", onDemand: false, showModelIdentifiers: true }),
  toolSettings: toolSettingsSchema,
  models: z.array(modelSchema),
});

const defaults: AppConfig = {
  server: { baseUrl: "http://localhost:8888/v1", apiKey: "" },
  profile: { name: "User" },
  preferences: { sendReasoningToModel: false, exportReasoning: true, language: "en", onDemand: false, showModelIdentifiers: true },
  toolSettings: DEFAULT_TOOL_SETTINGS,
  models: [],
};

const configPath = path.join(dataDir, "config.json");

function claimLegacyCustomizations(config: AppConfig) {
  const owner = db.prepare("SELECT id FROM users WHERE role = 'superadmin' ORDER BY created_at LIMIT 1").get() as { id: string } | undefined;
  if (!owner) return { config, changed: false };
  let changed = false;
  for (const model of config.models) {
    if (model.isAlias && !model.ownerId) { model.ownerId = owner.id; model.isPublic = false; changed = true; }
    for (const preset of model.reasoningPresets) {
      if (preset.kind === "custom" && !preset.ownerId) { preset.ownerId = owner.id; changed = true; }
    }
  }
  return { config, changed };
}

async function readLegacyConfig(filePath: string) {
  try {
    const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
    const result = configSchema.safeParse(raw);
    if (result.success) return result.data;
    console.error(`Invalid legacy config at ${filePath}, using defaults`, result.error);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`Unable to read legacy config at ${filePath}, using defaults`, error);
    }
  }
  return undefined;
}

export async function readConfig(): Promise<AppConfig> {
  const stored = db.prepare("SELECT value FROM app_config WHERE id = 1").get() as { value: string } | undefined;
  if (stored) {
    try {
      const claimed = claimLegacyCustomizations(configSchema.parse(JSON.parse(stored.value)));
      if (claimed.changed) db.prepare("UPDATE app_config SET value = ?, updated_at = ? WHERE id = 1").run(JSON.stringify(claimed.config), new Date().toISOString());
      return claimed.config;
    }
    catch (error) { console.error("Invalid SQLite config, recovering from configured defaults", error); }
  }

  // data/config.json was used by older releases. Import it only when SQLite
  // has no valid application settings; app-config.json is hosting-only.
  const legacyConfig = await readLegacyConfig(configPath);
  let config: AppConfig = legacyConfig || structuredClone(defaults);
  if (config.models.length === 1 && config.models[0]?.id === "default-model") {
    config = {
      ...structuredClone(defaults),
      server: { ...defaults.server, apiKey: config.server.apiKey },
      profile: config.profile,
    };
  }
  return writeConfig(claimLegacyCustomizations(config).config);
}

export async function writeConfig(input: unknown): Promise<AppConfig> {
  const parsed = configSchema.parse(input);
  db.prepare(`
    INSERT INTO app_config(id, value, updated_at) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(JSON.stringify(parsed), new Date().toISOString());
  return parsed;
}

function isAdmin(user: AuthUser) { return user.role === "admin" || user.role === "superadmin"; }

export function canUseModel(model: ModelConfig, user: AuthUser) {
  return !model.isAlias || !model.ownerId || model.ownerId === user.id || model.isPublic === true;
}

function visiblePreset(preset: ReasoningPreset, user: AuthUser) {
  return preset.kind === "builtin" || !preset.ownerId || preset.ownerId === user.id;
}

export function publicConfig(config: AppConfig, user: AuthUser): PublicConfig {
  const preferences: AppConfig["preferences"] = {
    ...config.preferences,
    sendReasoningToModel: typeof user.preferences.sendReasoningToModel === "boolean" ? user.preferences.sendReasoningToModel : config.preferences.sendReasoningToModel,
    exportReasoning: typeof user.preferences.exportReasoning === "boolean" ? user.preferences.exportReasoning : config.preferences.exportReasoning,
    language: user.preferences.language === "ko" || user.preferences.language === "en" ? user.preferences.language : config.preferences.language,
  };
  return {
    ...config,
    profile: { name: user.displayName },
    preferences,
    models: config.models.filter((model) => canUseModel(model, user)).map((model) => ({
      ...model,
      reasoningPresets: model.reasoningPresets.filter((preset) => visiblePreset(preset, user)),
    })),
    server: {
      ...config.server,
      apiKey: "",
      hasApiKey: Boolean(config.server.apiKey || process.env.OPENAI_API_KEY),
    },
    account: { id: user.id, username: user.username, displayName: user.displayName, role: user.role },
  };
}

function mergePresets(current: ReasoningPreset[], incoming: ReasoningPreset[], user: AuthUser, ownsModel: boolean) {
  const admin = isAdmin(user);
  const currentById = new Map(current.map((preset) => [preset.id, preset]));
  const result: ReasoningPreset[] = [];
  for (const candidate of incoming) {
    const existing = currentById.get(candidate.id);
    if (candidate.kind === "builtin") {
      if (ownsModel || admin) result.push({ ...candidate, ownerId: undefined });
      else if (existing) result.push(existing);
      continue;
    }
    if (!existing || existing.ownerId === user.id || (ownsModel && (!existing.ownerId || existing.ownerId === user.id))) {
      result.push({ ...candidate, ownerId: user.id });
    } else result.push(existing);
  }
  for (const preset of current) {
    const editable = preset.kind === "builtin" ? ownsModel || admin : preset.ownerId === user.id || (ownsModel && !preset.ownerId);
    if (!editable && !result.some((item) => item.id === preset.id)) result.push(preset);
  }
  return result;
}

export async function writeConfigForUser(input: unknown, user: AuthUser): Promise<AppConfig> {
  const incoming = configSchema.parse(input);
  const current = await readConfig(); const admin = isAdmin(user);
  const currentById = new Map(current.models.map((model) => [model.id, model]));
  const models: ModelConfig[] = [];

  for (const candidate of incoming.models) {
    const existing = currentById.get(candidate.id);
    if (!existing) {
      if (candidate.isAlias) models.push({ ...candidate, ownerId: user.id, isPublic: candidate.isPublic === true,
        reasoningPresets: candidate.reasoningPresets.map((preset) => preset.kind === "custom" ? { ...preset, ownerId: user.id } : preset) });
      else if (admin) models.push(candidate);
      continue;
    }
    if (existing.isAlias) {
      const owns = existing.ownerId === user.id || (!existing.ownerId && admin);
      models.push(owns ? { ...candidate, ownerId: existing.ownerId || user.id, reasoningPresets: mergePresets(existing.reasoningPresets, candidate.reasoningPresets, user, true) } : existing);
    } else {
      const base = admin ? { ...candidate, ownerId: undefined, isPublic: undefined } : existing;
      models.push({ ...base, reasoningPresets: mergePresets(existing.reasoningPresets, candidate.reasoningPresets, user, false) });
    }
  }
  for (const existing of current.models) {
    const accessible = canUseModel(existing, user);
    const mayDelete = existing.isAlias ? existing.ownerId === user.id || (!existing.ownerId && admin) : admin;
    if ((!accessible || !mayDelete) && !models.some((model) => model.id === existing.id)) models.push(existing);
  }

  const preferences = { ...current.preferences, ...incoming.preferences };
  const userPreferences = {
    sendReasoningToModel: incoming.preferences.sendReasoningToModel,
    exportReasoning: incoming.preferences.exportReasoning,
    language: incoming.preferences.language,
  };
  updateUserPreferences(user.id, admin ? incoming.profile.name : user.displayName, userPreferences);
  return writeConfig({
    server: admin ? { ...incoming.server, apiKey: incoming.server.apiKey || current.server.apiKey } : current.server,
    profile: current.profile,
    preferences: admin ? preferences : current.preferences,
    toolSettings: admin ? incoming.toolSettings : current.toolSettings,
    models,
  });
}

export function inferModel(input: string | Record<string, unknown>): ModelConfig {
  const modelId = typeof input === "string" ? input : String(input.id || "");
  const id = modelId.toLowerCase();
  const record = typeof input === "string" ? {} : input;
  const capabilities = typeof record.capabilities === "object" && record.capabilities ? record.capabilities as Record<string, unknown> : {};
  const advertised = record.reasoning_efforts || record.supported_reasoning_efforts || capabilities.reasoning_efforts;
  const knownQwen = /qwen3\.8/i.test(modelId);
  const efforts = Array.isArray(advertised)
    ? advertised.map(String)
    : knownQwen ? ["none", "low", "medium", "high", "xhigh"] : [];
  const reasoningSupported = Boolean(record.reasoning_supported ?? capabilities.reasoning ?? efforts.length) || /(reason|o1|o3|o4|gpt-5|qwen3|deepseek-r1|thinking)/i.test(id);
  const knownGemma = /gemma4.*31b/i.test(modelId);
  const friendlyName = knownQwen ? "Qwen3.8 27B" : knownGemma ? "Gemma 4 31B" : modelId.split(/[\/_-]/).filter(Boolean).slice(-2).join(" ").replace(/\b\w/g, (c) => c.toUpperCase());
  const sourceModel = knownQwen && /esatapedico/i.test(modelId)
    ? `${modelId}:Qwen3.8-27B-NVFP4-MTP-HIGH`
    : knownGemma && record.quant ? `${modelId}:${String(record.quant)}` : modelId;
  const normalizedEfforts = efforts.length ? efforts : reasoningSupported ? ["low", "medium", "high"] : [];
  const apiContextWindowTokens = inferApiContextWindowTokens(record);
  return {
    id: modelId,
    name: friendlyName,
    sourceModel,
    description: efforts.length ? "Reasoning efforts advertised by server" : reasoningSupported ? "Reasoning capability inferred from model metadata" : "Detected from server",
    isAlias: false,
    visible: true,
    reasoningSupported,
    reasoningEfforts: normalizedEfforts,
    apiContextWindowTokens,
    reasoningPresets: normalizedEfforts.length
      ? normalizedEfforts.map((effort) => ({ id: effort.replaceAll("_", "-"), name: effort === "xhigh" ? "Extra High" : effort.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase()), kind: "builtin" as const, effort }))
      : [{ id: "default", name: "Default", kind: "custom" as const }],
  };
}
