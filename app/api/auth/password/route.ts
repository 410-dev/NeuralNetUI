import { authErrorResponse, changePassword, clearSession, requireUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function PUT(request: Request) {
  try {
    const user = requireUser(request); const body = await request.json();
    await changePassword(user, String(body.currentPassword || ""), String(body.newPassword || ""));
    return Response.json({ ok: true }, { headers: { "Set-Cookie": clearSession(request) } });
  } catch (error) { return authErrorResponse(error); }
}
