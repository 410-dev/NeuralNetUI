import { authErrorResponse, requireUser } from "@/lib/auth";
import { hasPushSubscription, pushDeviceCount, pushToUser, rememberPushSubject, removePushSubscription, savePushSubscription, vapidPublicKey } from "@/lib/agent/push";
import { publicOrigin } from "@/lib/vm-installer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = requireUser(request); const endpoint = new URL(request.url).searchParams.get("endpoint");
    return Response.json({ publicKey: vapidPublicKey(), devices: pushDeviceCount(user.id), ...(endpoint ? { registered: hasPushSubscription(user.id, endpoint) } : {}) });
  } catch (error) { return authErrorResponse(error); }
}

/** Registers this device for agent notifications; `{ test: true }` sends a test notification to every device instead. */
export async function POST(request: Request) {
  try {
    const user = requireUser(request); const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (body.test === true) {
      const results = await pushToUser(user.id, { title: body.ko === false ? "Neural Chat agent" : "Neural Chat 에이전트", body: body.ko === false ? "Test notification: agent notifications reach this device." : "테스트 알림입니다. 에이전트 알림이 이 기기에 도착합니다.", tag: "neuralnetui-agent-test" });
      return Response.json({ results, devices: pushDeviceCount(user.id) });
    }
    savePushSubscription(user.id, body, request.headers.get("user-agent") || undefined);
    rememberPushSubject(publicOrigin(request));
    return Response.json({ subscribed: true, devices: pushDeviceCount(user.id) });
  } catch (error) { return authErrorResponse(error); }
}

export async function DELETE(request: Request) {
  try { const user = requireUser(request); const body = await request.json().catch(() => ({})) as { endpoint?: unknown }; removePushSubscription(user.id, String(body.endpoint || "")); return Response.json({ devices: pushDeviceCount(user.id) }); }
  catch (error) { return authErrorResponse(error); }
}
