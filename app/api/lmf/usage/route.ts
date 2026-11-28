import { authErrorResponse, requireUser } from "@/lib/auth";
import { connectionHeaders, envApiKey } from "@/lib/connection-drivers";
import { lmfEndpoint, quotaTargets, type LmfQuotaTarget } from "@/lib/lmf";
import { lmfRouterConnections } from "@/lib/lmf-routers";
import type { ConnectionConfig } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Remaining provider quota of every target the account's LMFuseFramework routing models may pick (`/v1/lmf/route`).
 * Antigravity reports none here; its quota comes separately from `/api/lmf/agy-quota`.
 */
export async function GET(request: Request) {
  try { return Response.json({ sections: await sections(requireUser(request).id, false) }); } catch (error) { return authErrorResponse(error); }
}

/**
 * The refresh button: LMFuseFramework 0.3.6+ probes each routed account whose quota it has not read for five minutes
 * (`POST /v1/lmf/route/refresh`); an older server just answers with what it has.
 */
export async function POST(request: Request) {
  try { return Response.json({ sections: await sections(requireUser(request).id, true) }); } catch (error) { return authErrorResponse(error); }
}

async function routeStatus(connection: ConnectionConfig, refresh: boolean) {
  const headers = connectionHeaders(connection, envApiKey(connection.driver));
  if (refresh) {
    const response = await fetch(lmfEndpoint(connection.baseUrl, "route/refresh"), { method: "POST", headers, signal: AbortSignal.timeout(120_000), cache: "no-store" });
    if (response.status !== 404 && response.status !== 405) return response;
    await response.body?.cancel().catch(() => undefined);
  }
  return fetch(lmfEndpoint(connection.baseUrl, "route"), { headers, signal: AbortSignal.timeout(8_000), cache: "no-store" });
}

async function sections(userId: string, refresh: boolean) {
  return Promise.all((await lmfRouterConnections(userId)).map(async ({ model, connection }) => {
    const base = { id: connection.id, name: model.name || connection.name };
    try {
      const response = await routeStatus(connection, refresh);
      if (!response.ok) { await response.body?.cancel().catch(() => undefined); return { ...base, targets: [] as LmfQuotaTarget[], error: `HTTP ${response.status}` }; }
      return { ...base, targets: quotaTargets(await response.json(), model) };
    } catch (error) { return { ...base, targets: [] as LmfQuotaTarget[], error: error instanceof Error ? error.message : String(error) }; }
  }));
}
