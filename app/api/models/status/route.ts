import { authErrorResponse, requireUser } from "@/lib/auth";
import { canUseModel, readConfig } from "@/lib/config";
import { connectionForModel, connectionHeaders } from "@/lib/connection-drivers";
import { connectionOnline } from "@/lib/connection-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reports which model servers are unreachable so the picker can hide their models. */
export async function GET(request: Request) {
  try {
    const user = requireUser(request);
    const config = await readConfig();
    const used = new Set(config.models.filter(model => canUseModel(model, user)).map(model => connectionForModel(config.connections, model)?.id).filter(Boolean));
    const connections = config.connections.filter(connection => used.has(connection.id));
    const results = await Promise.all(connections.map(async connection => {
      const headers = connectionHeaders(connection, connection.driver === "openai" ? process.env.OPENAI_API_KEY || "" : "");
      const key = `${connection.id}\0${connection.driver}\0${connection.baseUrl}\0${headers.Authorization || ""}`;
      return { id: connection.id, online: await connectionOnline(key, { driver: connection.driver, baseUrl: connection.baseUrl, headers }) };
    }));
    return Response.json({ offlineConnectionIds: results.filter(item => !item.online).map(item => item.id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return authErrorResponse(error); }
}
