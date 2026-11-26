import { authErrorResponse, requireUser } from "@/lib/auth";
import { isViewingAgent, reportAgentPresence } from "@/lib/agent/presence";
import { clearPushedNotifications } from "@/lib/agent/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The agent screen reports while it is visible; the first report after being away closes notifications on every device. */
export async function POST(request: Request) {
  try {
    const user = requireUser(request); const body = await request.json().catch(() => ({})) as { deviceId?: unknown; visible?: unknown };
    const wasViewing = isViewingAgent(user.id);
    reportAgentPresence(user.id, String(body.deviceId || "unknown"), body.visible === true);
    if (body.visible === true && !wasViewing) void clearPushedNotifications(user.id).catch(() => undefined);
    return Response.json({ ok: true });
  } catch (error) { return authErrorResponse(error); }
}
