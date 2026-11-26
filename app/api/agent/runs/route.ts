import { authErrorResponse, requireUser } from "@/lib/auth";
import { listAgentRuns } from "@/lib/agent/store";
import { cancelAgentRun } from "@/lib/agent/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Subagent history, newest first: running, waiting and finished runs. */
export async function GET(request: Request) {
  try {
    const user = requireUser(request); const query = new URL(request.url).searchParams;
    const status = query.get("status") === "active" ? "active" : query.get("status") === "finished" ? "finished" : undefined;
    const page = Math.max(1, Number(query.get("page")) || 1), pageSize = 20;
    const { runs, total } = listAgentRuns(user.id, { status, limit: pageSize, offset: (page - 1) * pageSize });
    return Response.json({ runs, total, page, pageCount: Math.max(1, Math.ceil(total / pageSize)) });
  } catch (error) { return authErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const user = requireUser(request); const body = await request.json() as { action?: string; id?: string };
    if (body.action !== "cancel") return Response.json({ error: "Unsupported action." }, { status: 400 });
    cancelAgentRun(user.id, String(body.id || ""));
    return Response.json({ cancelled: true });
  } catch (error) { return authErrorResponse(error); }
}
