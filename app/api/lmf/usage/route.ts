import { authErrorResponse, requireUser } from "@/lib/auth";
import { readConfig } from "@/lib/config";
import { connectionHeaders, envApiKey } from "@/lib/connection-drivers";
import { lmfEndpoint, quotaTargets, type LmfQuotaTarget } from "@/lib/lmf";
import { planServesModel } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Remaining provider quota of every target the account's LMFuseFramework routing models may pick (`/v1/lmf/route`).
 * A provider that reports no quota (Antigravity, for one) comes back with no windows.
 */
export async function GET(request: Request) {
  try {
    const user = requireUser(request);
    const config = await readConfig();
    const routers = config.models.filter(model => model.routerModel && !model.isAlias && model.visible !== false && model.connectionId && planServesModel(user.id, model.id, model.sourceModel));
    const seen = new Set<string>();
    const sections = await Promise.all(routers.filter(model => !seen.has(model.connectionId!) && seen.add(model.connectionId!)).map(async model => {
      const connection = config.connections.find(item => item.id === model.connectionId);
      if (!connection || connection.driver !== "lmf" || connection.disabled) return undefined;
      const base = { id: connection.id, name: model.name || connection.name };
      try {
        const response = await fetch(lmfEndpoint(connection.baseUrl, "route"), { headers: connectionHeaders(connection, envApiKey(connection.driver)), signal: AbortSignal.timeout(8_000), cache: "no-store" });
        if (!response.ok) { await response.body?.cancel().catch(() => undefined); return { ...base, targets: [] as LmfQuotaTarget[], error: `HTTP ${response.status}` }; }
        return { ...base, targets: quotaTargets(await response.json(), model) };
      } catch (error) { return { ...base, targets: [] as LmfQuotaTarget[], error: error instanceof Error ? error.message : String(error) }; }
    }));
    return Response.json({ sections: sections.filter(Boolean) });
  } catch (error) { return authErrorResponse(error); }
}
