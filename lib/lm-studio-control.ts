import { lmStudioEndpoint, modelsEndpoint } from "./connection-drivers.ts";

type LmStudioModelRecord = {
  id?: string;
  key?: string;
  selected_variant?: string;
  variants?: string[];
  loaded_instances?: unknown[];
};

const loads = new Map<string, Promise<void>>();

export function isLmStudioModelLoaded(payload: unknown, ...identifiers: Array<string | undefined>) {
  if (!payload || typeof payload !== "object") return false;
  const models = (payload as { models?: unknown }).models;
  if (!Array.isArray(models)) return false;
  const requested = new Set(identifiers.filter((value): value is string => Boolean(value)));
  const record = models.find((candidate): candidate is LmStudioModelRecord => {
    if (!candidate || typeof candidate !== "object") return false;
    const model = candidate as LmStudioModelRecord;
    return [model.id, model.key, model.selected_variant, ...(Array.isArray(model.variants) ? model.variants : [])]
      .some((value) => typeof value === "string" && requested.has(value));
  });
  return Boolean(record && Array.isArray(record.loaded_instances) && record.loaded_instances.length > 0);
}

export async function ensureLmStudioModelLoaded(options: {
  baseUrl: string;
  headers: Record<string, string>;
  sourceModel: string;
  modelId: string;
  contextWindowTokens?: number;
  signal: AbortSignal;
  request?: typeof fetch;
}) {
  const { baseUrl, headers, sourceModel, modelId, contextWindowTokens, signal, request = fetch } = options;
  const key = `${baseUrl.replace(/\/$/, "")}\0${sourceModel}`;
  const existing = loads.get(key);
  if (existing) return existing;
  const pending = (async () => {
    const listResponse = await request(modelsEndpoint("lmstudio", baseUrl), { headers, signal, cache: "no-store" });
    if (!listResponse.ok) throw new Error((await listResponse.text()) || `Model list failed with ${listResponse.status}`);
    const payload = await listResponse.json().catch(() => ({}));
    if (isLmStudioModelLoaded(payload, sourceModel, modelId)) return;
    const loadResponse = await request(lmStudioEndpoint(baseUrl, "load"), { method: "POST", headers, body: JSON.stringify({ model: sourceModel, ...(contextWindowTokens ? { context_length: contextWindowTokens } : {}) }), signal });
    if (!loadResponse.ok && loadResponse.status !== 409) throw new Error((await loadResponse.text()) || `Model load failed with ${loadResponse.status}`);
  })();
  loads.set(key, pending);
  try { await pending; }
  finally { if (loads.get(key) === pending) loads.delete(key); }
}
