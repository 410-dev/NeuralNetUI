import { connectionHeaders, modelsEndpoint } from "./connection-drivers.ts";
import { ConnectionError, httpFailure, invalidShapeFailure, listingModels, readListingJson, serverAnswered, transportFailure } from "./connection-errors.ts";
import type { ConnectionConfig, ConnectionDriver } from "./types.ts";

type Probe = { driver: ConnectionDriver; baseUrl: string; headers: Record<string, string> };
export type ProbeResult = "online" | "error" | "offline";

/**
 * A server is online when its model listing answers with the expected JSON. One that answers with anything
 * else (a rejected key, an error status, a page that is not JSON) is reported as an error; only a transport
 * failure or timeout counts as offline.
 */
export async function probeConnection(probe: Probe, fetcher: typeof fetch = fetch, timeoutMs = 3_000): Promise<ProbeResult> {
  try {
    const response = await fetcher(modelsEndpoint(probe.driver, probe.baseUrl), { headers: probe.headers, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new ConnectionError(httpFailure(response.status)); }
    if (!listingModels(probe.driver, await readListingJson(response))) throw new ConnectionError(invalidShapeFailure(probe.driver));
    return "online";
  } catch (error) { const failure = transportFailure(error); return serverAnswered(failure) && failure.code !== "invalid-url" ? "error" : "offline"; }
}

type CacheEntry = { state: ProbeResult; checkedAt: number; pending?: Promise<ProbeResult> };
declare global { var neuralConnectionStatus: Map<string, CacheEntry> | undefined; }
const cache = globalThis.neuralConnectionStatus ?? new Map<string, CacheEntry>();
globalThis.neuralConnectionStatus = cache;

/** Deduplicates concurrent checks and reuses a result for a few seconds so opening the picker repeatedly stays cheap. */
export function connectionProbe(key: string, probe: Probe, maxAgeMs = 5_000, fetcher: typeof fetch = fetch): Promise<ProbeResult> {
  const cached = cache.get(key);
  if (cached?.pending) return cached.pending;
  if (cached && Date.now() - cached.checkedAt < maxAgeMs) return Promise.resolve(cached.state);
  const pending = probeConnection(probe, fetcher).then(state => { cache.set(key, { state, checkedAt: Date.now() }); return state; });
  cache.set(key, { state: cached?.state ?? "online", checkedAt: cached?.checkedAt ?? 0, pending });
  return pending;
}

export type ConnectionState = ProbeResult | "disabled";
type StatusTarget = Pick<ConnectionConfig, "id" | "driver" | "baseUrl" | "apiKey" | "clearApiKey" | "disabled">;

/** Disabled servers are reported without a probe; every other server is checked through the shared cache. */
export async function connectionStates(connections: StatusTarget[], envKey = "", fetcher: typeof fetch = fetch): Promise<Record<string, ConnectionState>> {
  const entries = await Promise.all(connections.map(async (connection): Promise<[string, ConnectionState]> => {
    if (connection.disabled) return [connection.id, "disabled"];
    const headers = connectionHeaders(connection, connection.driver === "openai" ? envKey : "");
    const key = `${connection.id}\0${connection.driver}\0${connection.baseUrl}\0${headers.Authorization || ""}`;
    return [connection.id, await connectionProbe(key, { driver: connection.driver, baseUrl: connection.baseUrl, headers }, 5_000, fetcher)];
  }));
  return Object.fromEntries(entries);
}
