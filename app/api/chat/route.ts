import { authErrorResponse, requireUser } from "@/lib/auth";
import { startChatJob, type StartChatJobInput } from "@/lib/chat-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = requireUser(request);
    const snapshot = await startChatJob(await request.json() as StartChatJobInput, user.id);
    return Response.json(snapshot, { status: 202 });
  } catch (error) {
    const auth = authErrorResponse(error); if (auth.status !== 500) return auth;
    return Response.json({ error: error instanceof Error ? error.message : "채팅 작업을 시작하지 못했습니다." }, { status: 400 });
  }
}
