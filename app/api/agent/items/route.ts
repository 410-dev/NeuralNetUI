import { authErrorResponse, requireUser } from "@/lib/auth";
import { addAgentItem, listAgentItems, removeAgentItem, updateAgentItem, type AgentItemKind } from "@/lib/agent/store";
import { agentAccess, markAgentChanged } from "@/lib/agent/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const kindOf = (value: unknown) => value === "todo" || value === "event" || value === "memory" ? value as AgentItemKind : undefined;
function guard(request: Request) { const user = requireUser(request); if (!agentAccess(user.id).enabled) throw Object.assign(new Error("The agent is not available on this plan."), { status: 403 }); return user; }

/** The workboard's to-dos, events and memories, which the person can also edit. */
export async function GET(request: Request) {
  try { const user = guard(request); return Response.json({ items: listAgentItems(user.id, kindOf(new URL(request.url).searchParams.get("kind"))) }); }
  catch (error) { return authErrorResponse(error); }
}
export async function POST(request: Request) {
  try { const user = guard(request); const body = await request.json(); const item = addAgentItem(user.id, { ...body, kind: kindOf(body.kind) }); markAgentChanged(user.id); return Response.json({ item }, { status: 201 }); }
  catch (error) { return authErrorResponse(error); }
}
export async function PATCH(request: Request) {
  try { const user = guard(request); const body = await request.json(); const item = updateAgentItem(user.id, String(body.id || ""), body); markAgentChanged(user.id); return Response.json({ item }); }
  catch (error) { return authErrorResponse(error); }
}
export async function DELETE(request: Request) {
  try { const user = guard(request); const body = await request.json(); removeAgentItem(user.id, String(body.id || "")); markAgentChanged(user.id); return new Response(null, { status: 204 }); }
  catch (error) { return authErrorResponse(error); }
}
