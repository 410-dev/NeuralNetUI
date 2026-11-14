import { connectionHeaders } from "./connection-drivers.ts";
import { probeConnection, type ProbeResult } from "./connection-status.ts";
import type { ConnectionConfig } from "./types.ts";

/**
 * A connection's addresses in priority order: its base URL first, then its backup URLs. Backups are assumed to
 * serve the same models, so any of them can take a request meant for the connection.
 */
export function connectionEndpoints(connection: Pick<ConnectionConfig, "baseUrl" | "backupUrls">): string[] {
  const seen = new Set<string>(); const endpoints: string[] = [];
  for (const raw of [connection.baseUrl, ...(connection.backupUrls || [])]) {
    const url = typeof raw === "string" ? raw.trim() : "";
    const key = url.replace(/\/+$/, "");
    if (!url || seen.has(key)) continue;
    seen.add(key); endpoints.push(url);
  }
  return endpoints;
}

export type EndpointLoad = { active: number; inputTokens: number; outputTokens: number };

declare global { var neuralEndpointLoads: Map<string, EndpointLoad> | undefined; var neuralEndpointProbes: Map<string, { state: ProbeResult; checkedAt: number; pending?: Promise<ProbeResult> }> | undefined; }
const loads = globalThis.neuralEndpointLoads ?? new Map<string, EndpointLoad>();
globalThis.neuralEndpointLoads = loads;
const probes = globalThis.neuralEndpointProbes ?? new Map<string, { state: ProbeResult; checkedAt: number; pending?: Promise<ProbeResult> }>();
globalThis.neuralEndpointProbes = probes;

const loadKey = (url: string) => url.trim().replace(/\/+$/, "");
function loadOf(url: string): EndpointLoad {
  const key = loadKey(url);
  let load = loads.get(key);
  if (!load) { load = { active: 0, inputTokens: 0, outputTokens: 0 }; loads.set(key, load); }
  return load;
}

/** A snapshot of how busy each address is, for display and tests. */
export function endpointLoad(url: string): EndpointLoad { return { ...loadOf(url) }; }

/**
 * When every address is online, the least busy one wins: an idle one before a working one, then the fewest
 * requests in flight, then the fewest input and output tokens handled so far, then priority. Otherwise the first
 * online address in priority order wins. With nothing online the primary is used, so its error surfaces.
 */
export function chooseEndpoint(states: ProbeResult[], endpointLoads: EndpointLoad[]): number {
  if (states.length <= 1) return 0;
  if (states.every(state => state === "online")) {
    let best = 0;
    for (let index = 1; index < states.length; index += 1) {
      const a = endpointLoads[index], b = endpointLoads[best];
      const rank = (load: EndpointLoad) => [load.active > 0 ? 1 : 0, load.active, load.inputTokens + load.outputTokens];
      const [ra, rb] = [rank(a), rank(b)];
      const cmp = ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2];
      if (cmp < 0) best = index;
    }
    return best;
  }
  const online = states.indexOf("online");
  return online >= 0 ? online : 0;
}

function probeEndpoint(connection: ConnectionConfig, url: string, headers: Record<string, string>, fetcher: typeof fetch, maxAgeMs: number, timeoutMs: number): Promise<ProbeResult> {
  const key = `${connection.driver}\0${loadKey(url)}\0${headers.Authorization || ""}`;
  const cached = probes.get(key);
  if (cached?.pending) return cached.pending;
  if (cached && Date.now() - cached.checkedAt < maxAgeMs) return Promise.resolve(cached.state);
  const pending = probeConnection({ driver: connection.driver, baseUrl: url, headers }, fetcher, timeoutMs)
    .then(state => { probes.set(key, { state, checkedAt: Date.now() }); return state; });
  probes.set(key, { state: cached?.state ?? "online", checkedAt: cached?.checkedAt ?? 0, pending });
  return pending;
}

export type RoutedConnection<T extends ConnectionConfig> = {
  connection: T; endpoint: string;
  /** Adds a finished request's tokens to the address's running totals. */
  record: (inputTokens?: number, outputTokens?: number) => void;
  /** Marks the request finished on the address. Safe to call more than once. */
  release: () => void;
};

/**
 * Picks the address a request goes to and marks it busy until released. A connection without backups is
 * returned as it is, without probing. The returned connection carries the chosen address as its base URL.
 */
export async function routeConnection<T extends ConnectionConfig>(connection: T, envKey = "", fetcher: typeof fetch = fetch, options: { maxAgeMs?: number; timeoutMs?: number } = {}): Promise<RoutedConnection<T>> {
  const endpoints = connectionEndpoints(connection);
  let index = 0;
  if (endpoints.length > 1) {
    const headers = connectionHeaders(connection, connection.driver === "openai" ? envKey : "");
    const states = await Promise.all(endpoints.map(url => probeEndpoint(connection, url, headers, fetcher, options.maxAgeMs ?? 5_000, options.timeoutMs ?? 3_000)));
    // Chosen and marked busy in the same tick, so requests starting together spread across idle addresses.
    index = chooseEndpoint(states, endpoints.map(loadOf));
  }
  const endpoint = endpoints[index] || connection.baseUrl;
  const load = loadOf(endpoint); load.active += 1;
  let released = false;
  return {
    connection: endpoint === connection.baseUrl ? connection : { ...connection, baseUrl: endpoint },
    endpoint,
    record: (inputTokens = 0, outputTokens = 0) => {
      if (Number.isFinite(inputTokens) && inputTokens > 0) load.inputTokens += Math.floor(inputTokens);
      if (Number.isFinite(outputTokens) && outputTokens > 0) load.outputTokens += Math.floor(outputTokens);
    },
    release: () => { if (released) return; released = true; load.active = Math.max(0, load.active - 1); },
  };
}
