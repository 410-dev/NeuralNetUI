import { authErrorResponse, requireUser } from "@/lib/auth";
import { createMcpConnection, listMcpConnections, mcpEntitlement } from "@/lib/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try { const user = requireUser(request); return Response.json({ connections: listMcpConnections(user.id), entitlement: mcpEntitlement(user.id) }); }
  catch (error) { return authErrorResponse(error); }
}

export async function POST(request: Request) {
  try { const user = requireUser(request); return Response.json({ connection: createMcpConnection(user.id, await request.json()) }, { status: 201 }); }
  catch (error) { return authErrorResponse(error); }
}
