import { authErrorResponse, requireUser } from "@/lib/auth";
import { connectionHeaders, envApiKey } from "@/lib/connection-drivers";
import { agyQuotaTargets, lmfEndpoint, type LmfAgyQuota } from "@/lib/lmf";
import { lmfRouterConnections } from "@/lib/lmf-routers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Antigravity quota of the account's LMFuseFramework routing targets (`/v1/lmf/route/agy-quota`, LMF 0.3.12+). LMF reads
 * it from the agy TUI, which takes seconds and can fail on its own, so the usage popover fetches it apart from
 * `/api/lmf/usage` and lays it over those targets by key. GET reuses LMF's last reading (≤ 5 min); POST (the refresh
 * button) asks for a fresh one. Sections whose LMF lacks the endpoint answer `unsupported` and keep their windows empty.
 */
export async function GET(request: Request) {
  try { return Response.json({ sections: await sections(requireUser(request).id, false) }); } catch (error) { return authErrorResponse(error); }
}

export async function POST(request: Request) {
  try { return Response.json({ sections: await sections(requireUser(request).id, true) }); } catch (error) { return authErrorResponse(error); }
}

async function sections(userId: string, refresh: boolean) {
  return Promise.all((await lmfRouterConnections(userId)).map(async ({ connection }) => {
    try {
      const response = await fetch(lmfEndpoint(connection.baseUrl, "route/agy-quota"), { method: refresh ? "POST" : "GET", headers: connectionHeaders(connection, envApiKey(connection.driver)), signal: AbortSignal.timeout(90_000), cache: "no-store" });
      if (response.status === 404 || response.status === 405) { await response.body?.cancel().catch(() => undefined); return { id: connection.id, targets: [] as LmfAgyQuota[], unsupported: true }; }
      if (!response.ok) { await response.body?.cancel().catch(() => undefined); return { id: connection.id, targets: [] as LmfAgyQuota[], error: `HTTP ${response.status}` }; }
      return { id: connection.id, targets: agyQuotaTargets(await response.json()) };
    } catch (error) { return { id: connection.id, targets: [] as LmfAgyQuota[], error: error instanceof Error ? error.message : String(error) }; }
  }));
}
