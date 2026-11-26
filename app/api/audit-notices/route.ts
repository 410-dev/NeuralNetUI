import { authErrorResponse, requireUser } from "@/lib/auth";
import { acknowledgeAuditNotices, pendingAuditNotices } from "@/lib/audit-unlock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Audits an administrator unlocked outside organization mode, not yet shown to this user. */
export async function GET(request: Request) {
  try { const user = requireUser(request); return Response.json({ notices: pendingAuditNotices(user.id) }); }
  catch (error) { return authErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const user = requireUser(request);
    const body = await request.json().catch(() => ({})) as { ids?: unknown };
    acknowledgeAuditNotices(user.id, Array.isArray(body.ids) ? body.ids.map(String) : []);
    return Response.json({ acknowledged: true });
  } catch (error) { return authErrorResponse(error); }
}
