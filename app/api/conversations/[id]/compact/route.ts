import { authErrorResponse, AuthError, requireUser } from "@/lib/auth";
import { compactConversation } from "@/lib/context-compact";
import { branchOwnedBy } from "@/lib/context-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** /compact and /compact summarize from the composer. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = requireUser(request); const { id } = await context.params;
    const body = await request.json().catch(() => ({})) as { branchId?: unknown; mode?: unknown; modelId?: unknown; aliasBaseModelId?: unknown };
    const branchId = typeof body.branchId === "string" ? body.branchId : "";
    if (!branchOwnedBy(branchId, id, user.id)) throw new AuthError("대화를 찾을 수 없습니다.", 404);
    const result = await compactConversation({
      userId: user.id, conversationId: id, branchId, mode: body.mode === "summarize" ? "summarize" : "default",
      modelId: typeof body.modelId === "string" ? body.modelId : undefined,
      aliasBaseModelId: typeof body.aliasBaseModelId === "string" ? body.aliasBaseModelId : undefined,
      signal: request.signal,
    });
    return Response.json(result);
  } catch (error) {
    const response = authErrorResponse(error);
    // A failed summary call surfaces as a plain error; answer 400 so a proxy does not swap the body for its own page.
    return response.status >= 500 ? Response.json(await response.json(), { status: 400 }) : response;
  }
}
