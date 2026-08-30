import { authErrorResponse, requireUser } from "@/lib/auth";
import { getChatJob, submitChatToolInput } from "@/lib/chat-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = requireUser(request); const { id } = await context.params; const job = getChatJob(id, user.id);
    if (!job) return Response.json({ error: "실행 중인 채팅 작업이 없습니다." }, { status: 404 });
    const body = await request.json() as { toolCallId?: string; value?: unknown };
    if (!body.toolCallId) return Response.json({ error: "도구 호출 ID가 필요합니다." }, { status: 400 });
    return Response.json(submitChatToolInput(job, body.toolCallId, body.value));
  } catch (error) {
    const auth = authErrorResponse(error); if (auth.status !== 500) return auth;
    return Response.json({ error: error instanceof Error ? error.message : "도구 입력을 전달하지 못했습니다." }, { status: 400 });
  }
}
