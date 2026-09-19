import { authErrorResponse, requireUser } from "@/lib/auth";
import { testMcpConnection } from "@/lib/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try { const user = requireUser(request); return Response.json(await testMcpConnection(user.id, await request.json(), request.signal)); }
  catch (error) { return authErrorResponse(error); }
}
