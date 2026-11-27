import { authErrorResponse, requireUser } from "@/lib/auth";
import { estimateRequestOverhead } from "@/lib/chat-runtime";
import { agentConversation } from "@/lib/agent/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Estimated tokens every request of this chat carries besides the conversation (tool definitions, agent prompt). */
export async function POST(request: Request) {
  try {
    const user = requireUser(request);
    const body = await request.json() as { modelId?: string; aliasBaseModelId?: string; tools?: unknown; conversationId?: string; clientContext?: { timeZone?: string; locale?: string; language?: string } };
    if (!body.modelId) return Response.json({ error: "modelId is required." }, { status: 400 });
    const owner = body.conversationId ? agentConversation(body.conversationId) : undefined;
    // The agent's main chat uses the agent's own prompt and tool switches, not the composer's.
    const agent = owner?.userId === user.id && owner.kind === "main" ? (await import("@/lib/agent/runtime")).agentRequestShape(user.id) : undefined;
    const value = await estimateRequestOverhead(user.id, user.role, {
      modelId: body.modelId, aliasBaseModelId: body.aliasBaseModelId, tools: body.tools, conversationId: body.conversationId,
      clientContext: body.clientContext as never, ...(agent ? { agent } : {}),
    });
    return Response.json(value);
  } catch (error) {
    const auth = authErrorResponse(error); if (auth.status !== 500) return auth;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to estimate." }, { status: 400 });
  }
}
