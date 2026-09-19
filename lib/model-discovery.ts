import { connectionRoot, modelsEndpoint } from "./connection-drivers.ts";
import { ConnectionError, httpFailure, invalidShapeFailure, listingModels, readListingJson, transportFailure } from "./connection-errors.ts";
import type { ConnectionDriver } from "./types.ts";

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
