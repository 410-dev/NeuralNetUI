import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { AppConfig, ModelConfig, PublicConfig } from "./types";
import { dataDir, db } from "./database";

const presetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["builtin", "custom"]),
  effort: z.string().optional(),
  systemPrompt: z.string().optional(),
  systemPromptMode: z.enum(["replace", "prepend", "append"]).default("append"),
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
});

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
  }).default({ sendReasoningToModel: false, exportReasoning: true, language: "en" }),
  models: z.array(modelSchema),
});

const defaults: AppConfig = {
  server: { baseUrl: "http://localhost:8888/v1", apiKey: "" },
  profile: { name: "User" },
  preferences: { sendReasoningToModel: false, exportReasoning: true, language: "en" },
  models: [],
};

const configPath = path.join(dataDir, "config.json");

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
    try { return configSchema.parse(JSON.parse(stored.value)); }
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
  return writeConfig(config);
}

export async function writeConfig(input: unknown): Promise<AppConfig> {
  const parsed = configSchema.parse(input);
  db.prepare(`
    INSERT INTO app_config(id, value, updated_at) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(JSON.stringify(parsed), new Date().toISOString());
  return parsed;
}

export function publicConfig(config: AppConfig): PublicConfig {
  return {
    ...config,
    server: {
      ...config.server,
      apiKey: "",
      hasApiKey: Boolean(config.server.apiKey || process.env.OPENAI_API_KEY),
    },
  };
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
  return {
    id: modelId,
    name: friendlyName,
    sourceModel,
    description: efforts.length ? "Reasoning efforts advertised by server" : reasoningSupported ? "Reasoning capability inferred from model metadata" : "Detected from server",
    isAlias: false,
    visible: true,
    reasoningSupported,
    reasoningEfforts: normalizedEfforts,
    reasoningPresets: normalizedEfforts.length
      ? normalizedEfforts.map((effort) => ({ id: effort.replaceAll("_", "-"), name: effort === "xhigh" ? "Extra High" : effort.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase()), kind: "builtin" as const, effort }))
      : [{ id: "default", name: "Default", kind: "custom" as const }],
  };
}
