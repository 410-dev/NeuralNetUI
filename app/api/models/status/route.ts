import { authErrorResponse, requireAdmin, requireUser } from "@/lib/auth";
import { canUseModel, readConfig } from "@/lib/config";
import { connectionForModel } from "@/lib/connection-drivers";
import { connectionStates } from "@/lib/connection-status";
import type { ConnectionDriver } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "Cache-Control": "no-store" } };

/** Reports each model server the account can use as online, offline or disabled for the picker. */
export async function GET(request: Request) {
  try {
    const user = requireUser(request);
    const config = await readConfig();
    const used = new Set(config.models.filter(model => canUseModel(model, user)).map(model => connectionForModel(config.connections, model)?.id).filter(Boolean));
    const statuses = await connectionStates(config.connections.filter(connection => used.has(connection.id)), process.env.OPENAI_API_KEY || "");
    return Response.json({ statuses, offlineConnectionIds: Object.keys(statuses).filter(id => statuses[id] === "offline") }, noStore);
  } catch (error) { return authErrorResponse(error); }
}

/** Administrators check the connection settings draft, including unsaved addresses; saved keys fill in blank ones. */
export async function POST(request: Request) {
  try {
    requireAdmin(request);
    const body = await request.json().catch(() => ({})) as { connections?: unknown };
    const config = await readConfig();
    const drafts = (Array.isArray(body.connections) ? body.connections : []).slice(0, 32).flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const draft = item as Record<string, unknown>;
      const id = String(draft.id || ""); const baseUrl = String(draft.baseUrl || "");
      try { new URL(baseUrl); } catch { return id ? [{ id, driver: "openai" as ConnectionDriver, baseUrl: "", apiKey: "", invalid: true }] : []; }
      const saved = config.connections.find(connection => connection.id === id);
      const clearApiKey = draft.clearApiKey === true;
      const driver = draft.driver === "lmstudio" || draft.driver === "nnui" ? draft.driver : "openai";
      return [{ id, driver: driver as ConnectionDriver, baseUrl, apiKey: clearApiKey ? "" : String(draft.apiKey || saved?.apiKey || ""), clearApiKey, disabled: draft.disabled === true, invalid: false }];
    });
    const statuses = await connectionStates(drafts.filter(item => !item.invalid), process.env.OPENAI_API_KEY || "");
    for (const item of drafts) if (item.invalid) statuses[item.id] = "offline";
    return Response.json({ statuses }, noStore);
  } catch (error) { return authErrorResponse(error); }
}
