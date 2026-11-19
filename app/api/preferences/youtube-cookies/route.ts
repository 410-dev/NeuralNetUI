import { AuthError, authErrorResponse, requireUser } from "@/lib/auth";
import { deleteYoutubeCookies, saveYoutubeCookies, youtubeCookiesStatus } from "@/lib/youtube";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The account's own YouTube cookies (Netscape cookies.txt). The file itself is never sent back. */
export async function GET(request: Request) {
  try { const user = requireUser(request); return Response.json(await youtubeCookiesStatus(user.id)); }
  catch (error) { return authErrorResponse(error); }
}

export async function PUT(request: Request) {
  try {
    const user = requireUser(request);
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > 1024 * 1024) throw new AuthError("The cookie file is larger than 1 MB.", 413);
    const text = await request.text();
    return Response.json(await saveYoutubeCookies(user.id, text).catch(error => { throw new AuthError(error instanceof Error ? error.message : String(error), 400); }));
  } catch (error) { return authErrorResponse(error); }
}

export async function DELETE(request: Request) {
  try { const user = requireUser(request); await deleteYoutubeCookies(user.id); return Response.json(await youtubeCookiesStatus(user.id)); }
  catch (error) { return authErrorResponse(error); }
}
