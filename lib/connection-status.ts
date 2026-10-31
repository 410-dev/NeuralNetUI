import { connectionHeaders, modelsEndpoint } from "./connection-drivers.ts";
import { ConnectionError, httpFailure, invalidShapeFailure, listingModels, readListingJson, serverAnswered, transportFailure } from "./connection-errors.ts";
import { TRANSPORT_RETRY_DELAYS_MS } from "./transport-retry.ts";
import type { ConnectionConfig, ConnectionDriver } from "./types.ts";

type Probe = { driver: ConnectionDriver; baseUrl: string; headers: Record<string, string> };
export type ProbeResult = "online" | "error" | "offline";

/**
 * A server is online when its model listing answers with the expected JSON. One that answers with anything
 * else (a rejected key, an error status, a page that is not JSON) is reported as an error; only a transport
 * failure or timeout counts as offline.
 */
export async function probeConnection(probe: Probe, fetcher: typeof fetch = fetch, timeoutMs = 3_000): Promise<ProbeResult> {
  return (await probeOnce(probe, fetcher, timeoutMs)).state;
}

async function probeOnce(probe: Probe, fetcher: typeof fetch, timeoutMs: number): Promise<{ state: ProbeResult; refused: boolean }> {
  try {
    const response = await fetcher(modelsEndpoint(probe.driver, probe.baseUrl), { headers: probe.headers, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new ConnectionError(httpFailure(response.status)); }
    if (!listingModels(probe.driver, await readListingJson(response))) throw new ConnectionError(invalidShapeFailure(probe.driver));
    return { state: "online", refused: false };
  } catch (error) {
    const failure = transportFailure(error);
    if (serverAnswered(failure) && failure.code !== "invalid-url") return { state: "error", refused: false };
    return { state: "offline", refused: failure.code === "unreachable" };
  }
}

/**
 * A listing request that fails at once is tried again on the shared seven-attempt schedule before the server
 * is reported offline, so a brief restart does not hide its models. A timeout has already waited, so it is final.
 */
export async function probeWithRetry(probe: Probe, fetcher: typeof fetch = fetch, retryDelaysMs: readonly number[] = TRANSPORT_RETRY_DELAYS_MS, timeoutMs = 3_000): Promise<ProbeResult> {
  for (let attempt = 0; ; attempt += 1) {
    const result = await probeOnce(probe, fetcher, timeoutMs);
    if (!result.refused || attempt >= retryDelaysMs.length) return result.state;
    await new Promise(resolve => setTimeout(resolve, retryDelaysMs[attempt]));
  }
}

type CacheEntry = { state: ProbeResult; checkedAt: number; pending?: Promise<ProbeResult> };
declare global { var neuralConnectionStatus: Map<string, CacheEntry> | undefined; }
const cache = globalThis.neuralConnectionStatus ?? new Map<string, CacheEntry>();
globalThis.neuralConnectionStatus = cache;

/**
 * Deduplicates concurrent checks and reuses a result for a few seconds so opening the picker repeatedly stays cheap.
 * Only a server not already known to be offline gets the retry schedule; a confirmed outage is probed once.
 */
export function connectionProbe(key: string, probe: Probe, maxAgeMs = 5_000, fetcher: typeof fetch = fetch, retryDelaysMs: readonly number[] = TRANSPORT_RETRY_DELAYS_MS): Promise<ProbeResult> {
  const cached = cache.get(key);
  if (cached?.pending) return cached.pending;
  if (cached && Date.now() - cached.checkedAt < maxAgeMs) return Promise.resolve(cached.state);
  const pending = probeWithRetry(probe, fetcher, cached?.state === "offline" && cached.checkedAt ? [] : retryDelaysMs).then(state => { cache.set(key, { state, checkedAt: Date.now() }); return state; });
  cache.set(key, { state: cached?.state ?? "online", checkedAt: cached?.checkedAt ?? 0, pending });
  return pending;
}

export type ConnectionState = ProbeResult | "disabled";
type StatusTarget = Pick<ConnectionConfig, "id" | "driver" | "baseUrl" | "apiKey" | "clearApiKey" | "disabled">;

/** Disabled servers are reported without a probe; every other server is checked through the shared cache. */
export async function connectionStates(connections: StatusTarget[], envKey = "", fetcher: typeof fetch = fetch, retryDelaysMs: readonly number[] = TRANSPORT_RETRY_DELAYS_MS): Promise<Record<string, ConnectionState>> {
  const entries = await Promise.all(connections.map(async (connection): Promise<[string, ConnectionState]> => {
    if (connection.disabled) return [connection.id, "disabled"];
    const headers = connectionHeaders(connection, connection.driver === "openai" ? envKey : "");
    const key = `${connection.id}\0${connection.driver}\0${connection.baseUrl}\0${headers.Authorization || ""}`;
    return [connection.id, await connectionProbe(key, { driver: connection.driver, baseUrl: connection.baseUrl, headers }, 5_000, fetcher, retryDelaysMs)];
  }));
  return Object.fromEntries(entries);
}
