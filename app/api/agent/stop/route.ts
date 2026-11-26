import { authErrorResponse, requireUser } from "@/lib/auth";
import { stopAgentMain } from "@/lib/agent/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try { stopAgentMain(requireUser(request).id); return Response.json({ stopped: true }); }
  catch (error) { return authErrorResponse(error); }
}
