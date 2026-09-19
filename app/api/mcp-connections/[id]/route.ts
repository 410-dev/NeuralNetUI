import { authErrorResponse, requireUser } from "@/lib/auth";
import { deleteMcpConnection, updateMcpConnection } from "@/lib/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const user = requireUser(request), { id } = await context.params; return Response.json({ connection: updateMcpConnection(user.id, id, await request.json()) }); }
  catch (error) { return authErrorResponse(error); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const user = requireUser(request), { id } = await context.params; deleteMcpConnection(user.id, id); return new Response(null, { status: 204 }); }
  catch (error) { return authErrorResponse(error); }
}
