import { authErrorResponse, requireUser } from "@/lib/auth";
import { canUseModel, readConfig } from "@/lib/config";
import { db } from "@/lib/database";
import { aliasBaseModel } from "@/lib/alias-base-model";
import { baseModelForAlias } from "@/lib/model-context";
import { connectionForModel, connectionHeaders, envApiKey } from "@/lib/connection-drivers";
import { lmfEndpoint, lmfRouteLabel, lmfSessionTtlMs, routingFrom, storedLmfSession } from "@/lib/lmf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Which provider an LMFuseFramework routing model is using for this chat. `when=next` asks where the next request
 * goes (the session's next turn, or a one-shot request without a session); `when=current` asks what the last turn used.
 */
export async function GET(request: Request) {
  try {
    const user = requireUser(request);
    const query = new URL(request.url).searchParams;
    const when = query.get("when") === "current" ? "current" : "next";
    const config = await readConfig();
    const requested = config.models.find(model => model.id === query.get("modelId") && canUseModel(model, user));
    const base = requested && (aliasBaseModel(requested, config.models, query.get("aliasBaseModelId") || undefined) || baseModelForAlias(requested, config.models) || requested);
    const connection = base && connectionForModel(config.connections, base);
    if (!base || !connection || connection.driver !== "lmf" || !base.routerModel) return Response.json({ routing: null });
    const conversationId = query.get("conversationId") || "";
    const owned = conversationId && db.prepare("SELECT 1 FROM conversations WHERE id = ? AND user_id = ?").get(conversationId, user.id);
    const sessionId = owned ? storedLmfSession(conversationId, connection.id, base.sourceModel, lmfSessionTtlMs(connection)) : undefined;
    const headers = connectionHeaders(connection, envApiKey(connection.driver));
    const fetchJson = async (path: string) => {
      const response = await fetch(lmfEndpoint(connection.baseUrl, path), { headers, signal: AbortSignal.timeout(5_000), cache: "no-store" });
      return response.ok ? response.json() : undefined;
    };
    // A session the server no longer has falls back to where a fresh request would go.
    const payload = (sessionId ? await fetchJson(`sessions/${encodeURIComponent(sessionId)}`).catch(() => undefined) : undefined) ?? await fetchJson("route").catch(() => undefined);
    const entry = routingFrom(payload, when);
    if (!entry) return Response.json({ routing: null });
    return Response.json({ routing: { entry, label: lmfRouteLabel(base, entry), when } });
  } catch (error) { return authErrorResponse(error); }
}
