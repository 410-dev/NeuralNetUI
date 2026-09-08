import { connectionRoot, modelsEndpoint } from "./connection-drivers.ts";
import type { ConnectionDriver } from "./types.ts";

/** Enrich compatible endpoints with native LM Studio metadata when available. */
export async function discoverModelRecords(driver: ConnectionDriver, baseUrl: string, apiKey: string, fetcher: typeof fetch = fetch): Promise<Array<Record<string, unknown>>> {
  const request: RequestInit = { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, signal: AbortSignal.timeout(10_000), cache: "no-store" as const };
  const response = await fetcher(modelsEndpoint(driver, baseUrl), request);
  if (!response.ok) throw new Error(`Server responded with ${response.status}`);
  const payload = await response.json();
  const raw: unknown = driver === "lmstudio" ? payload?.models : payload?.data;
  const records = Array.isArray(raw) ? raw.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && (item.id || item.key) && (driver !== "lmstudio" || item.type === "llm"))) : [];
  if (driver === "lmstudio") return records;
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
