import { authErrorResponse, AuthError, requireUser } from "@/lib/auth";
import { normalizeContextState } from "@/lib/context-state";
import { branchOwnedBy, loadContextState, saveContextState } from "@/lib/context-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What a branch sends to the model (summary, dropped details, context-view edits). */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = requireUser(request); const { id } = await context.params;
    const branchId = new URL(request.url).searchParams.get("branchId") || "";
    if (!branchOwnedBy(branchId, id, user.id)) throw new AuthError("대화를 찾을 수 없습니다.", 404);
    return Response.json({ state: loadContextState(branchId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return authErrorResponse(error); }
}

/** Replaces a branch's context state with an edited one. The transcript is not changed. */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = requireUser(request); const { id } = await context.params;
    const body = await request.json().catch(() => ({})) as { branchId?: unknown; state?: unknown };
    const branchId = typeof body.branchId === "string" ? body.branchId : "";
    if (!branchOwnedBy(branchId, id, user.id)) throw new AuthError("대화를 찾을 수 없습니다.", 404);
    const state = normalizeContextState(body.state);
    saveContextState(branchId, state);
    return Response.json({ state });
  } catch (error) { return authErrorResponse(error); }
}
