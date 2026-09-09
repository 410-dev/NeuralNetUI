import { lmStudioEndpoint, modelsEndpoint } from "./connection-drivers.ts";
import { inferenceEndpoint } from "./inference-control.ts";
import { progressFetch, withSlowProgress } from "./chat-progress.ts";
import type { ChatWaitPhase, ConnectionConfig } from "./types.ts";
import { ModelBusyError, type ResidencyAdapter, type ResidentModel } from "./model-residency.ts";

function record(value: unknown): Record<string, unknown> | undefined { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function text(value: unknown) { return typeof value === "string" && value.trim() ? value : undefined; }
export function nativeResidents(payload: unknown): ResidentModel[] {
  const models = record(payload)?.models;
  if (!Array.isArray(models)) throw new Error("The model server returned an invalid loaded-model list.");
  return models.flatMap(value => {
    const model = record(value); if (model?.type === "embedding") return [];
    if (!model) throw new Error("The model server returned an invalid loaded-model record.");
    const id = text(model.key) || text(model.id);
    if (!id || !Array.isArray(model.loaded_instances)) throw new Error("The model server omitted loaded-model metadata; refusing automatic eviction.");
    const instances = model.loaded_instances.map(record).filter(item => Boolean(item));
    if (instances.length !== model.loaded_instances.length) throw new Error("The model server returned an invalid loaded instance.");
    const instanceIds = instances.map(item => text(item?.id)).filter((id): id is string => Boolean(id));
    if (instances.length !== instanceIds.length) throw new Error("The model server omitted an instance identifier; refusing automatic eviction.");
    return instanceIds.length ? [{ id, identifiers: [...new Set([id, text(model.selected_variant), ...(Array.isArray(model.variants) ? model.variants.map(text) : []), ...instanceIds].filter((value): value is string => Boolean(value)))], instanceIds, busy: instances.some(item => item?.status === "busy" || item?.status === "generating" || item?.busy === true) }] : [];
  });
}

export function legacyResidents(payload: unknown): ResidentModel[] {
  const status = record(payload);
  if (!status || !("loaded" in status || "model_identifier" in status || "active_model" in status)) throw new Error("This server does not expose a supported model-management API. Set the residency limit to 0 or use LM Studio.");
  const ids = new Set<string>();
  for (const id of [status.model_identifier, status.active_model, ...(Array.isArray(status.loaded) ? status.loaded : [])]) if (text(id)) ids.add(id as string);
  return [...ids].map(id => ({ id, identifiers: [id, ...(text(status.gguf_variant) ? [`${id}:${status.gguf_variant}`] : [])], instanceIds: [id], busy: status.busy === true || status.status === "generating" }));
}

function legacyLoadBody(source: string) {
  const separator = source.lastIndexOf(":"); const pathSeparator = Math.max(source.lastIndexOf("/"), source.lastIndexOf("\\"));
  return separator <= pathSeparator || separator === 1 ? { model_path: source } : { model_path: source.slice(0, separator), gguf_variant: source.slice(separator + 1) };
}

export function createResidencyAdapter(connection: ConnectionConfig, headers: Record<string, string>, contextWindowTokens: number | undefined, onPhase: (phase: ChatWaitPhase) => void, request: typeof fetch = fetch, onLoadProgress?: (progress: number) => void): ResidencyAdapter {
  let mode: "native" | "legacy" | undefined = connection.driver === "lmstudio" ? "native" : undefined;
  let phase: ChatWaitPhase = "preparing-response";
  async function call(url: string, signal: AbortSignal, body?: unknown) {
    const response = await progressFetch(url, { headers, signal, cache: "no-store", ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }) }, onPhase, phase, request);
    return response;
  }
  async function json(response: Response) {
    const result = await withSlowProgress(() => response.json(), () => onPhase("waiting-server")); onPhase(phase); return result;
  }
  async function ensureOk(response: Response) { if (!response.ok) throw new Error(`Model management failed (${response.status}): ${await response.text()}`); }
  return {
    async list(signal) {
      if (mode !== "legacy") {
        const response = await call(modelsEndpoint("lmstudio", connection.baseUrl), signal);
        if (response.ok) {
          const payload = await json(response);
          if (Array.isArray(record(payload)?.models)) { mode = "native"; return nativeResidents(payload); }
          if (mode === "native") throw new Error("The model server returned an invalid loaded-model list.");
        } else if (mode === "native" || ![404, 405].includes(response.status)) await ensureOk(response);
        mode = "legacy";
      }
      const response = await call(inferenceEndpoint(connection.baseUrl, "status"), signal); await ensureOk(response);
      return legacyResidents(await json(response));
    },
    async unload(model, signal) {
      phase = "freeing-space";
      for (const id of model.instanceIds) {
        const response = await call(mode === "native" ? lmStudioEndpoint(connection.baseUrl, "unload") : inferenceEndpoint(connection.baseUrl, "unload"), signal, mode === "native" ? { instance_id: id } : { model_path: id });
        if (response.status === 409) { await response.text(); throw new ModelBusyError("The model server reports that the model is busy."); }
        await ensureOk(response); await withSlowProgress(() => response.text(), () => onPhase("waiting-server"));
      }
    },
    async load(model, signal) {
      phase = "loading-model";
      if (mode === "native" && onLoadProgress) {
        const { loadWithProgress } = await import("./lm-studio-progress.ts");
        if (await loadWithProgress(connection.baseUrl, model, contextWindowTokens, signal, onLoadProgress, headers.Authorization)) return;
      }
      const response = await call(mode === "native" ? lmStudioEndpoint(connection.baseUrl, "load") : inferenceEndpoint(connection.baseUrl, "load"), signal, mode === "native" ? { model, ...(contextWindowTokens ? { context_length: contextWindowTokens } : {}) } : legacyLoadBody(model));
      if (response.status !== 409) await ensureOk(response);
      // A 409 is accepted only if the manager's subsequent list confirms the load.
      await withSlowProgress(() => response.text(), () => onPhase("waiting-server"));
    },
  };
}
