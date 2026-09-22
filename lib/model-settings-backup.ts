import { createHash } from "node:crypto";
import { serializeModelSettings } from "./model-settings.ts";
import { applyPreferredOrder } from "./ordered-list.ts";
import type { ModelConfig, ReasoningPreset } from "./types";

/**
 * The model settings a personal backup image carries: the same JSON as the settings download,
 * plus which aliases and reasoning templates the owner created, because the download strips
 * ownership and a restore must never claim somebody else's entries.
 */
export type ModelSettingsImage = { settings: unknown; ownedModelIds: string[]; ownedPresets: Array<{ modelId: string; presetId: string }> };
export type ModelSettingsTarget = { id: string; admin: boolean };
export type ModelSettingsReport = { aliases: number; presets: number; servedModels: number; skipped: number };
type Portable = Omit<ModelConfig, "ownerId" | "connectionId">;

const text = (value: unknown, max = 200_000) => typeof value === "string" && value.length <= max ? value : undefined;
const positiveInt = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
const presetKey = (modelId: string, presetId: string) => `${modelId}\0${presetId}`;

export function modelSettingsImage(models: ModelConfig[], owner: ModelSettingsTarget, defaults: { modelId?: string; reasoningPresetId?: string }): ModelSettingsImage {
  const usable = models.filter((model) => !model.isAlias || !model.ownerId || model.ownerId === owner.id || model.isPublic === true)
    .map((model) => ({ ...model, reasoningPresets: model.reasoningPresets.filter((preset) => preset.kind === "builtin" || !preset.ownerId || preset.ownerId === owner.id) }));
  const cleanDefaults = { ...(defaults.modelId ? { modelId: defaults.modelId } : {}), ...(defaults.reasoningPresetId ? { reasoningPresetId: defaults.reasoningPresetId } : {}) };
  return {
    settings: JSON.parse(serializeModelSettings(usable, cleanDefaults)),
    ownedModelIds: usable.filter((model) => model.isAlias && model.ownerId === owner.id).map((model) => model.id),
    ownedPresets: usable.flatMap((model) => model.reasoningPresets.filter((preset) => preset.kind === "custom" && preset.ownerId === owner.id).map((preset) => ({ modelId: model.id, presetId: preset.id }))),
  };
}

function readPreset(value: unknown): ReasoningPreset | undefined {
  if (!value || typeof value !== "object") return;
  const raw = value as Record<string, unknown>;
  const id = text(raw.id, 500), kind = raw.kind === "builtin" || raw.kind === "custom" ? raw.kind : undefined;
  if (!id || !kind) return;
  const mode = raw.systemPromptMode === "replace" || raw.systemPromptMode === "prepend" || raw.systemPromptMode === "append" ? raw.systemPromptMode : "append";
  return { id, name: text(raw.name, 500)?.trim() || id, kind, ...(text(raw.effort, 40) !== undefined ? { effort: text(raw.effort, 40) } : {}), ...(text(raw.systemPrompt) !== undefined ? { systemPrompt: text(raw.systemPrompt) } : {}), systemPromptMode: mode };
}

/** Reads each model on its own and keeps only fields this version understands, so older or newer images still restore what they can. */
export function readModelSettingsLeniently(value: unknown): { models: Portable[]; defaults: { modelId?: string; reasoningPresetId?: string }; skipped: number } | undefined {
  if (!value || typeof value !== "object") return;
  const raw = value as Record<string, unknown>;
  if (raw.format !== undefined && raw.format !== "neuralnetui-model-settings") return;
  if (!Array.isArray(raw.models)) return;
  let skipped = 0; const models: Portable[] = []; const seen = new Set<string>();
  for (const candidate of raw.models.slice(0, 10_000)) {
    const item = candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : undefined;
    const id = text(item?.id, 500), sourceModel = text(item?.sourceModel, 500) || (item?.isAlias ? undefined : id);
    if (!item || !id || !sourceModel || seen.has(id)) { skipped++; continue; }
    seen.add(id);
    const presets = Array.isArray(item.reasoningPresets) ? item.reasoningPresets.map(readPreset) : [];
    skipped += presets.filter((preset) => !preset).length;
    const edge = typeof item.visionMaxEdgePixels === "number" && Number.isFinite(item.visionMaxEdgePixels) ? Math.min(8192, Math.max(128, Math.round(item.visionMaxEdgePixels))) : undefined;
    models.push({
      id, sourceModel, name: text(item.name, 500)?.trim() || id,
      ...(text(item.description) !== undefined ? { description: text(item.description) } : {}),
      ...(text(item.systemPrompt) !== undefined ? { systemPrompt: text(item.systemPrompt) } : {}),
      isAlias: item.isAlias === true, visible: item.visible !== false, reasoningSupported: item.reasoningSupported === true,
      ...(Array.isArray(item.reasoningEfforts) ? { reasoningEfforts: item.reasoningEfforts.filter((effort): effort is string => typeof effort === "string" && effort.length <= 40) } : {}),
      reasoningPresets: presets.filter((preset): preset is ReasoningPreset => Boolean(preset)),
      ...(positiveInt(item.contextWindowTokens) ? { contextWindowTokens: positiveInt(item.contextWindowTokens) } : {}),
      ...(item.visionImageMode === "original" || item.visionImageMode === "max-resolution" ? { visionImageMode: item.visionImageMode } : {}),
      ...(edge ? { visionMaxEdgePixels: edge } : {}),
      ...(typeof item.imageGeneration === "boolean" ? { imageGeneration: item.imageGeneration } : {}),
      ...(typeof item.imageInput === "boolean" ? { imageInput: item.imageInput } : {}),
      ...(typeof item.isPublic === "boolean" ? { isPublic: item.isPublic } : {}),
    });
  }
  const defaults = raw.defaults && typeof raw.defaults === "object" ? raw.defaults as Record<string, unknown> : {};
  return { models, skipped, defaults: { ...(text(defaults.modelId, 500) ? { modelId: text(defaults.modelId, 500) } : {}), ...(text(defaults.reasoningPresetId, 500) ? { reasoningPresetId: text(defaults.reasoningPresetId, 500) } : {}) } };
}

function upsertPresets(existing: ReasoningPreset[], incoming: ReasoningPreset[]) {
  const result = [...existing]; let applied = 0, skipped = 0;
  for (const preset of incoming) {
    const index = result.findIndex((item) => item.id === preset.id);
    if (index < 0) result.push(preset);
    else if (result[index].kind === "custom" && result[index].ownerId === preset.ownerId) result[index] = preset;
    else { skipped++; continue; }
    applied++;
  }
  return { presets: result, applied, skipped };
}

/**
 * Applies a backup's model settings as the target account, following the same rules as saving the
 * settings form: every account restores its own aliases and templates, and only administrators
 * restore served-model settings. Served models are matched by id or served identifier; those this
 * workspace does not serve are skipped, and discovery-owned capabilities are left as detected.
 */
export function applyModelSettingsImage(models: ModelConfig[], image: unknown, target: ModelSettingsTarget, mode: "merge" | "replace") {
  const record = image && typeof image === "object" ? image as Partial<ModelSettingsImage> : undefined;
  const parsed = readModelSettingsLeniently(record?.settings);
  if (!record || !parsed) return;
  const ownedIds = new Set(Array.isArray(record.ownedModelIds) ? record.ownedModelIds.filter((id) => typeof id === "string") : parsed.models.filter((model) => model.isAlias).map((model) => model.id));
  const ownedPresets = new Set((Array.isArray(record.ownedPresets) ? record.ownedPresets : []).filter((item) => item && typeof item.modelId === "string" && typeof item.presetId === "string").map((item) => presetKey(item.modelId, item.presetId)));
  const report: ModelSettingsReport = { aliases: 0, presets: 0, servedModels: 0, skipped: parsed.skipped };
  const foreignIds = new Set(models.filter((model) => !model.isAlias || model.ownerId !== target.id).map((model) => model.id));
  const idMap = new Map<string, string>();
  const restored = new Map<string, ModelConfig>();
  for (const model of parsed.models) {
    if (!model.isAlias || !ownedIds.has(model.id)) continue;
    // An identifier already used by another account or a served model gets a stable private one.
    const id = foreignIds.has(model.id) ? `alias-${createHash("sha256").update(`${target.id}\0${model.id}`).digest("hex").slice(0, 24)}` : model.id;
    if (id !== model.id) idMap.set(model.id, id);
    restored.set(id, { ...model, id, isAlias: true, ownerId: target.id, reasoningPresets: model.reasoningPresets.map((preset) => preset.kind === "custom" ? { ...preset, ownerId: target.id } : preset) });
  }
  let next: ModelConfig[] = [];
  for (const model of models) {
    const own = model.isAlias && model.ownerId === target.id;
    if (own && restored.has(model.id)) { next.push({ ...restored.get(model.id)!, connectionId: model.connectionId }); restored.delete(model.id); report.aliases++; }
    else if (!own || mode === "merge") next.push(model);
  }
  for (const alias of restored.values()) { next.push(alias); report.aliases++; }
  const findTarget = (model: Portable) => {
    if (model.isAlias) return next.findIndex((item) => item.isAlias && item.id === model.id && item.ownerId !== target.id);
    const byId = next.findIndex((item) => !item.isAlias && item.id === model.id);
    return byId >= 0 ? byId : next.findIndex((item) => !item.isAlias && item.sourceModel === model.sourceModel);
  };
  const mapped = new Map<string, string>();
  if (target.admin) {
    const keptPresets = new Set<string>();
    for (const model of parsed.models) {
      if (model.isAlias && ownedIds.has(model.id)) continue;
      const index = findTarget(model);
      if (index < 0) { report.skipped++; continue; }
      const current = next[index]; mapped.set(model.id, current.id);
      const mine = model.reasoningPresets.filter((preset) => preset.kind === "custom" && ownedPresets.has(presetKey(model.id, preset.id))).map((preset) => ({ ...preset, ownerId: target.id }));
      for (const preset of mine) keptPresets.add(presetKey(current.id, preset.id));
      let presets = current.reasoningPresets;
      if (!current.isAlias) {
        // Built-in templates follow the server's capabilities; only their wording is restored.
        presets = presets.map((preset) => { const saved = preset.kind === "builtin" ? model.reasoningPresets.find((item) => item.kind === "builtin" && item.id === preset.id) : undefined; return saved ? { ...preset, name: saved.name, systemPrompt: saved.systemPrompt, systemPromptMode: saved.systemPromptMode } : preset; });
      }
      const merged = upsertPresets(presets, mine); report.presets += merged.applied; report.skipped += merged.skipped;
      next[index] = current.isAlias ? { ...current, reasoningPresets: merged.presets } : {
        ...current, name: model.name, description: model.description, systemPrompt: model.systemPrompt, visible: model.visible,
        contextWindowTokens: model.contextWindowTokens, visionImageMode: model.visionImageMode ?? current.visionImageMode, visionMaxEdgePixels: model.visionMaxEdgePixels ?? current.visionMaxEdgePixels,
        imageGeneration: model.imageGeneration ?? current.imageGeneration, imageInput: model.imageInput ?? current.imageInput,
        reasoningPresets: merged.presets,
      };
      if (!current.isAlias) report.servedModels++;
    }
    if (mode === "replace") next = next.map((model) => model.isAlias && model.ownerId === target.id ? model : { ...model, reasoningPresets: model.reasoningPresets.filter((preset) => preset.kind !== "custom" || preset.ownerId !== target.id || keptPresets.has(presetKey(model.id, preset.id))) });
    // Administrators also get the saved model order back for the models this workspace has.
    next = applyPreferredOrder(next, parsed.models.map((model) => model.isAlias && ownedIds.has(model.id) ? idMap.get(model.id) || model.id : mapped.get(model.id) || model.id));
  } else {
    report.skipped += parsed.models.filter((model) => !(model.isAlias && ownedIds.has(model.id))).reduce((sum, model) => sum + model.reasoningPresets.filter((preset) => ownedPresets.has(presetKey(model.id, preset.id))).length, 0);
  }
  const rename = (id?: string) => id ? idMap.get(id) || mapped.get(id) || id : undefined;
  return { models: next, idMap, report, defaults: { modelId: rename(parsed.defaults.modelId), reasoningPresetId: parsed.defaults.reasoningPresetId } };
}
