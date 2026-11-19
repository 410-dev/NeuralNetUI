import { AuthError, authErrorResponse, logAdminAudit, requireAdmin } from "@/lib/auth";
import { removeYtDlp, updateYtDlp, ytDlpStatus } from "@/lib/youtube";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function superadmin(request: Request) {
  const user = requireAdmin(request);
  if (user.role !== "superadmin") throw new AuthError("Only Superadmin can install or update yt-dlp.", 403);
  return user;
}

export async function GET(request: Request) {
  try { requireAdmin(request); return Response.json(await ytDlpStatus()); }
  catch (error) { return authErrorResponse(error); }
}

/** Installs or updates yt-dlp to the latest stable release for this server. */
export async function POST(request: Request) {
  try {
    const user = superadmin(request);
    const status = await updateYtDlp(request.signal).catch(error => { throw new AuthError(error instanceof Error ? error.message : String(error), 502); });
    logAdminAudit(user.id, user.id, "yt_dlp_updated", status.version || "");
    return Response.json(status);
  } catch (error) { return authErrorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const user = superadmin(request);
    await removeYtDlp();
    logAdminAudit(user.id, user.id, "yt_dlp_removed");
    return Response.json(await ytDlpStatus());
  } catch (error) { return authErrorResponse(error); }
}
