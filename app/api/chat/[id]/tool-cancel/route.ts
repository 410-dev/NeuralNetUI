import { authErrorResponse, requireUser } from "@/lib/auth";
import { cancelChatTool, getChatJob } from "@/lib/chat-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cancels one running tool call; the reply continues without its result. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = requireUser(request); const { id } = await context.params; const job = getChatJob(id, user.id);
    if (!job) return Response.json({ error: "실행 중인 채팅 작업이 없습니다." }, { status: 404 });
    const body = await request.json().catch(() => ({})) as { toolCallId?: string };
    if (!body.toolCallId) return Response.json({ error: "도구 호출 ID가 필요합니다." }, { status: 400 });
    return Response.json({ cancelled: cancelChatTool(job, body.toolCallId) });
  } catch (error) { return authErrorResponse(error); }
}
