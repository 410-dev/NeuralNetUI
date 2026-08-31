import { z } from "zod";
import type { ModelConfig } from "./types";

const presetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["builtin", "custom"]),
  effort: z.string().optional(),
  systemPrompt: z.string().optional(),
  systemPromptMode: z.enum(["replace", "prepend", "append"]).optional(),
}).strict();

const modelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  sourceModel: z.string().min(1),
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  isAlias: z.boolean(),
  visible: z.boolean(),
  reasoningSupported: z.boolean(),
  reasoningEfforts: z.array(z.string()).optional(),
  reasoningPresets: z.array(presetSchema),
  contextWindowTokens: z.number().int().positive().optional(),
  apiContextWindowTokens: z.number().int().positive().optional(),
  isPublic: z.boolean().optional(),
}).strict();

const exportSchema = z.object({
  format: z.literal("neuralnetui-model-settings"),
  version: z.literal(1),
  exportedAt: z.string().datetime(),
  defaults: z.object({
    modelId: z.string().min(1).optional(),
    reasoningPresetId: z.string().min(1).optional(),
  }).strict(),
  models: z.array(modelSchema).max(10_000),
}).strict();

export type ModelSettingsExport = z.infer<typeof exportSchema>;

function portableModel(model: ModelConfig): ModelSettingsExport["models"][number] {
  const { ownerId: _ownerId, reasoningPresets, ...rest } = model;
  return {
    ...rest,
    reasoningPresets: reasoningPresets.map(({ ownerId: _presetOwnerId, ...preset }) => preset),
  };
}

export function serializeModelSettings(
  models: ModelConfig[],
  defaults: ModelSettingsExport["defaults"],
  exportedAt = new Date(),
) {
  return JSON.stringify({
    format: "neuralnetui-model-settings",
    version: 1,
    exportedAt: exportedAt.toISOString(),
    defaults,
    models: models.map(portableModel),
  }, null, 2);
}

export function parseModelSettings(text: string): ModelSettingsExport {
  return exportSchema.parse(JSON.parse(text));
}
