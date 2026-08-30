import { authErrorResponse, requireUser } from "@/lib/auth";
import { getChatJob, stopChatJob, subscribeToChatJob } from "@/lib/chat-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = requireUser(request); const { id } = await context.params; const job = getChatJob(id, user.id);
    if (!job) return Response.json({ error: "실행 중인 채팅 작업이 없습니다." }, { status: 404 });
    return new Response(subscribeToChatJob(job), { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
  } catch (error) { return authErrorResponse(error); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = requireUser(request); const { id } = await context.params; const job = getChatJob(id, user.id);
    if (!job) return Response.json({ error: "실행 중인 채팅 작업이 없습니다." }, { status: 404 });
    stopChatJob(job); return new Response(null, { status: 202 });
  } catch (error) { return authErrorResponse(error); }
}
