import { authErrorResponse, requireAdmin } from "@/lib/auth";
import { readConfig } from "@/lib/config";
import { connectionHeaders, envApiKey } from "@/lib/connection-drivers";
import { lmfEndpoint, lmfRouteKey, routeEntries } from "@/lib/lmf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The providers an LMFuseFramework connection's routing model can pick, for naming them in model settings. */
export async function GET(request: Request) {
  try {
    requireAdmin(request);
    const connectionId = new URL(request.url).searchParams.get("connectionId") || "";
    const connection = (await readConfig()).connections.find(item => item.id === connectionId);
    if (!connection || connection.driver !== "lmf") return Response.json({ error: "Not an LMFuseFramework connection." }, { status: 400 });
    const response = await fetch(lmfEndpoint(connection.baseUrl, "route"), { headers: connectionHeaders(connection, envApiKey(connection.driver)), signal: AbortSignal.timeout(10_000), cache: "no-store" }).catch(error => { throw Object.assign(new Error(`The LMFuseFramework server could not be reached: ${error instanceof Error ? error.message : String(error)}`), { status: 502 }); });
    if (!response.ok) return Response.json({ error: (await response.text()) || `The server responded with ${response.status}.` }, { status: 502 });
    return Response.json({ entries: routeEntries(await response.json()).map(entry => ({ ...entry, key: lmfRouteKey(entry) })) });
  } catch (error) { return authErrorResponse(error); }
}
