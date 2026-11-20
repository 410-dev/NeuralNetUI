import { AuthError, authErrorResponse, logAdminAudit, requireAdmin } from "@/lib/auth";
import { deleteYoutubeCookies, saveYoutubeCookies, youtubeCookiesStatus } from "@/lib/youtube";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The server's YouTube cookies (Netscape cookies.txt) for the yt-dlp tool. The file itself is never sent back. */
export async function GET(request: Request) {
  try { requireAdmin(request); return Response.json(await youtubeCookiesStatus()); }
  catch (error) { return authErrorResponse(error); }
}

export async function PUT(request: Request) {
  try {
    const user = requireAdmin(request);
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > 1024 * 1024) throw new AuthError("The cookie file is larger than 1 MB.", 413);
    const text = await request.text();
    const status = await saveYoutubeCookies(text).catch(error => { throw new AuthError(error instanceof Error ? error.message : String(error), 400); });
    logAdminAudit(user.id, user.id, "youtube_cookies_saved");
    return Response.json(status);
  } catch (error) { return authErrorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const user = requireAdmin(request);
    await deleteYoutubeCookies();
    logAdminAudit(user.id, user.id, "youtube_cookies_removed");
    return Response.json(await youtubeCookiesStatus());
  } catch (error) { return authErrorResponse(error); }
}
