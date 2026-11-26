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
    // Periodic runs can share one chat (and its LMF session); show only this run's part of it.
    if (conversation && run.startedAt) {
      const from = Date.parse(run.startedAt), to = run.finishedAt ? Date.parse(run.finishedAt) : Infinity;
      for (const branch of conversation.branches) branch.messages = branch.messages.filter(message => { const at = Date.parse(message.createdAt); return !Number.isFinite(at) || (at >= from && at <= to); });
    }
    return Response.json({ run, conversation });
  } catch (error) { return authErrorResponse(error); }
}
