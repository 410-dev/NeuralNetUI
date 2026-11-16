import { connectionRoot, modelsEndpoint } from "./connection-drivers.ts";
import { ConnectionError, httpFailure, invalidShapeFailure, listingModels, readListingJson, transportFailure } from "./connection-errors.ts";
import type { ConnectionDriver } from "./types.ts";
import { samplingFromServer, type SamplingParams } from "./sampling-params.ts";

/** Enrich compatible endpoints with native LM Studio metadata when available. Failures throw a classified `ConnectionError`. */
export async function discoverModelRecords(driver: ConnectionDriver, baseUrl: string, apiKey: string, fetcher: typeof fetch = fetch): Promise<Array<Record<string, unknown>>> {
  const request: RequestInit = { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, signal: AbortSignal.timeout(10_000), cache: "no-store" as const };
  let response: Response;
  try { response = await fetcher(modelsEndpoint(driver, baseUrl), request); }
  catch (error) { throw new ConnectionError(transportFailure(error)); }
  if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new ConnectionError(httpFailure(response.status, response.statusText)); }
  const raw = listingModels(driver, await readListingJson(response));
  if (!raw) throw new ConnectionError(invalidShapeFailure(driver));
  const records = (raw as Array<Record<string, unknown> | null>).filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && (item.id || item.key) && (driver !== "lmstudio" || item.type === "llm")));
  if (driver !== "openai") return records;
  try {
    const native = await fetcher(`${connectionRoot(baseUrl)}/api/v1/models`, { ...request, signal: AbortSignal.timeout(3_000) });
    if (!native.ok) return records;
    const data = await native.json();
    if (!Array.isArray(data?.models)) return records;
    return records.map(record => {
      const match = data.models.find((item: Record<string, unknown>) => item?.type === "llm" && (item.key === record.id || Array.isArray(item.loaded_instances) && item.loaded_instances.some(instance => instance?.id === record.id) || Array.isArray(item.variants) && item.variants.includes(record.id)));
      return match ? { ...record, ...match, key: record.id, id: record.id } : record;
    });
  } catch { return records; }
}

/**
 * Asks a llama.cpp-style server for each model's default sampling settings (`/props?model=`). A server without
 * that endpoint, or one that does not answer within a few seconds, simply reports nothing.
 */
export async function discoverPropsSamplingDefaults(baseUrl: string, apiKey: string, modelIds: string[], fetcher: typeof fetch = fetch): Promise<Map<string, SamplingParams>> {
  const defaults = new Map<string, SamplingParams>();
  const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  let root: string; try { root = connectionRoot(baseUrl); } catch { return defaults; }
  await Promise.all(modelIds.slice(0, 64).map(async id => {
    try {
      const response = await fetcher(`${root}/props?model=${encodeURIComponent(id)}`, { headers, signal: AbortSignal.timeout(3_000), cache: "no-store" });
      if (!response.ok) { await response.body?.cancel().catch(() => undefined); return; }
      const body = await response.json() as { default_generation_settings?: { params?: unknown } & Record<string, unknown> };
      const settings = body?.default_generation_settings;
      const params = samplingFromServer(settings?.params ?? settings);
      if (params) defaults.set(id, params);
    } catch { /* no defaults for this model */ }
  }));
  return defaults;
}
