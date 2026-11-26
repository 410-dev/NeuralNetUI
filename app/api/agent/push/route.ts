import { authErrorResponse, requireUser } from "@/lib/auth";
import { removePushSubscription, savePushSubscription, vapidPublicKey } from "@/lib/agent/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try { requireUser(request); return Response.json({ publicKey: vapidPublicKey() }); }
  catch (error) { return authErrorResponse(error); }
}

/** Registers this device for agent notifications. */
export async function POST(request: Request) {
  try { const user = requireUser(request); savePushSubscription(user.id, await request.json(), request.headers.get("user-agent") || undefined); return Response.json({ subscribed: true }); }
  catch (error) { return authErrorResponse(error); }
}

export async function DELETE(request: Request) {
  try { const user = requireUser(request); const body = await request.json().catch(() => ({})) as { endpoint?: unknown }; removePushSubscription(user.id, String(body.endpoint || "")); return new Response(null, { status: 204 }); }
  catch (error) { return authErrorResponse(error); }
}
