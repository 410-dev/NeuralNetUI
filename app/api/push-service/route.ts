import { AuthError, authErrorResponse, logAdminAudit, requireAdmin } from "@/lib/auth";
import { firebaseStatus, removeUploadedFirebaseCredentials, saveFirebaseCredentials } from "@/lib/agent/fcm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The server's Firebase project for app notifications. Administrators see which one; only the superadmin changes it. */
export async function GET(request: Request) {
  try { requireAdmin(request); return Response.json(firebaseStatus()); }
  catch (error) { return authErrorResponse(error); }
}

function requireSuperadmin(request: Request) {
  const user = requireAdmin(request);
  if (user.role !== "superadmin") throw new AuthError("최고 관리자만 바꿀 수 있습니다.", 403);
  return user;
}

/** Body: the service account key file as uploaded (JSON text). It is never sent back. */
export async function PUT(request: Request) {
  try {
    const user = requireSuperadmin(request);
    const text = await request.text();
    if (text.length > 32_000) throw new AuthError("파일이 너무 큽니다. Firebase 서비스 계정 키(JSON)를 올려 주세요.", 413);
    const status = await saveFirebaseCredentials(text);
    logAdminAudit(user.id, user.id, "push.firebase.upload", JSON.stringify({ projectId: status.projectId, clientEmail: status.clientEmail }));
    return Response.json(status);
  } catch (error) { return authErrorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const user = requireSuperadmin(request);
    const status = removeUploadedFirebaseCredentials();
    logAdminAudit(user.id, user.id, "push.firebase.remove");
    return Response.json(status);
  } catch (error) { return authErrorResponse(error); }
}
