import { authErrorResponse, requireUser } from "@/lib/auth";
import { hasNativePushToken, hasPushSubscription, pushDeviceCount, pushToUser, rememberPushSubject, removeNativePushToken, removePushSubscription, saveNativePushToken, savePushSubscription, vapidPublicKey } from "@/lib/agent/push";
import { fcmConfigured, firebaseProjectId } from "@/lib/agent/fcm";
import { publicOrigin } from "@/lib/vm-installer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = requireUser(request); const params = new URL(request.url).searchParams;
    const endpoint = params.get("endpoint"), nativeToken = params.get("nativeToken");
    return Response.json({ publicKey: vapidPublicKey(), devices: pushDeviceCount(user.id), nativeAvailable: fcmConfigured(), nativeProjectId: firebaseProjectId(),
      ...(endpoint ? { registered: hasPushSubscription(user.id, endpoint) } : nativeToken ? { registered: hasNativePushToken(user.id, nativeToken) } : {}) });
  } catch (error) { return authErrorResponse(error); }
}

/**
 * Registers this device for agent notifications: a browser subscription, or `{ native: { token, platform } }` from the
 * mobile app. `{ test: true }` sends a test notification to every device instead (`urgent: true` for the urgent kind).
 */
export async function POST(request: Request) {
  try {
    const user = requireUser(request); const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (body.test === true) {
      const urgent = body.urgent === true, en = body.ko === false;
      const results = await pushToUser(user.id, { urgent, title: en ? (urgent ? "Neural Chat agent · urgent" : "Neural Chat agent") : (urgent ? "Neural Chat 에이전트 · 긴급" : "Neural Chat 에이전트"),
        body: en ? (urgent ? "Test of an urgent notification: it rings and pops up." : "Test notification: agent notifications reach this device.") : (urgent ? "긴급 알림 테스트입니다. 소리와 함께 화면 위에 표시됩니다." : "테스트 알림입니다. 에이전트 알림이 이 기기에 도착합니다."), tag: "neuralnetui-agent-test" });
      return Response.json({ results, devices: pushDeviceCount(user.id) });
    }
    if (body.native && typeof body.native === "object") {
      saveNativePushToken(user.id, body.native as { token?: unknown; platform?: unknown; projectId?: unknown }, request.headers.get("user-agent") || undefined);
      return Response.json({ subscribed: true, devices: pushDeviceCount(user.id), nativeAvailable: fcmConfigured(), nativeProjectId: firebaseProjectId() });
    }
    savePushSubscription(user.id, body, request.headers.get("user-agent") || undefined);
    rememberPushSubject(publicOrigin(request));
    return Response.json({ subscribed: true, devices: pushDeviceCount(user.id) });
  } catch (error) { return authErrorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const user = requireUser(request); const body = await request.json().catch(() => ({})) as { endpoint?: unknown; nativeToken?: unknown };
    if (typeof body.nativeToken === "string") removeNativePushToken(user.id, body.nativeToken); else removePushSubscription(user.id, String(body.endpoint || ""));
    return Response.json({ devices: pushDeviceCount(user.id) });
  }
  catch (error) { return authErrorResponse(error); }
}
