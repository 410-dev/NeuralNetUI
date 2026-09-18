import { connectionHeaders, modelsEndpoint } from "./connection-drivers.ts";
import type { ConnectionConfig, ConnectionDriver } from "./types.ts";

type Probe = { driver: ConnectionDriver; baseUrl: string; headers: Record<string, string> };

/** A server is online when it answers the model listing without a transport failure or a 5xx status. */
export async function probeConnection(probe: Probe, fetcher: typeof fetch = fetch, timeoutMs = 3_000): Promise<boolean> {
  try {
    const response = await fetcher(modelsEndpoint(probe.driver, probe.baseUrl), { headers: probe.headers, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    await response.body?.cancel().catch(() => undefined);
    return response.status < 500;
  } catch { return false; }
}

declare global { var neuralConnectionStatus: Map<string, { online: boolean; checkedAt: number; pending?: Promise<boolean> }> | undefined; }
const cache = globalThis.neuralConnectionStatus ?? new Map<string, { online: boolean; checkedAt: number; pending?: Promise<boolean> }>();
globalThis.neuralConnectionStatus = cache;

/** Deduplicates concurrent checks and reuses a result for a few seconds so opening the picker repeatedly stays cheap. */
export function connectionOnline(key: string, probe: Probe, maxAgeMs = 5_000, fetcher: typeof fetch = fetch): Promise<boolean> {
  const cached = cache.get(key);
  if (cached?.pending) return cached.pending;
  if (cached && Date.now() - cached.checkedAt < maxAgeMs) return Promise.resolve(cached.online);
  const pending = probeConnection(probe, fetcher).then(online => { cache.set(key, { online, checkedAt: Date.now() }); return online; });
  cache.set(key, { online: cached?.online ?? true, checkedAt: cached?.checkedAt ?? 0, pending });
  return pending;
}

export type ConnectionState = "online" | "offline" | "disabled";
type StatusTarget = Pick<ConnectionConfig, "id" | "driver" | "baseUrl" | "apiKey" | "clearApiKey" | "disabled">;

/** Disabled servers are reported without a probe; every other server is checked through the shared cache. */
export async function connectionStates(connections: StatusTarget[], envKey = "", fetcher: typeof fetch = fetch): Promise<Record<string, ConnectionState>> {
  const entries = await Promise.all(connections.map(async (connection): Promise<[string, ConnectionState]> => {
    if (connection.disabled) return [connection.id, "disabled"];
    const headers = connectionHeaders(connection, connection.driver === "openai" ? envKey : "");
    const key = `${connection.id}\0${connection.driver}\0${connection.baseUrl}\0${headers.Authorization || ""}`;
    return [connection.id, await connectionOnline(key, { driver: connection.driver, baseUrl: connection.baseUrl, headers }, 5_000, fetcher) ? "online" : "offline"];
  }));
  return Object.fromEntries(entries);
}
