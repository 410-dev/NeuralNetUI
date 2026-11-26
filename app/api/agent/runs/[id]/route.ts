import { authErrorResponse, requireUser } from "@/lib/auth";
import { getAgentRun } from "@/lib/agent/store";
import { readConversation } from "@/lib/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One subagent run with its session transcript. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = requireUser(request); const { id } = await context.params;
    const run = getAgentRun(user.id, id);
    if (!run) return Response.json({ error: "Run not found." }, { status: 404 });
    const conversation = run.conversationId ? await readConversation(run.conversationId, user.id) : null;
    return Response.json({ run, conversation });
  } catch (error) { return authErrorResponse(error); }
}
