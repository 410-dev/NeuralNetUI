import { authErrorResponse, requireUser } from "@/lib/auth";
import { addAgentSchedule, listAgentSchedules, removeAgentSchedule, updateAgentSchedule } from "@/lib/agent/store";
import { agentAccess, markAgentChanged, releaseScheduleSessions } from "@/lib/agent/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function guard(request: Request) { const user = requireUser(request); const access = agentAccess(user.id); if (!access.enabled) throw Object.assign(new Error("The agent is not available on this plan."), { status: 403 }); return { user, access }; }
const input = (body: Record<string, unknown>) => ({ title: typeof body.title === "string" ? body.title : undefined, instructions: typeof body.instructions === "string" ? body.instructions : undefined, at: typeof body.at === "string" ? body.at : undefined, inMinutes: typeof body.inMinutes === "number" ? body.inMinutes : undefined, everyMinutes: typeof body.everyMinutes === "number" ? body.everyMinutes : undefined, enabled: typeof body.enabled === "boolean" ? body.enabled : undefined });

/** Scheduled wakeups and recurring work (notify-wakeup), which the person can also manage. */
export async function GET(request: Request) {
  try { const { user } = guard(request); return Response.json({ schedules: listAgentSchedules(user.id) }); }
  catch (error) { return authErrorResponse(error); }
}
export async function POST(request: Request) {
  try { const { user, access } = guard(request); const schedule = addAgentSchedule(user.id, input(await request.json()), access.minIntervalMinutes); markAgentChanged(user.id); return Response.json({ schedule }, { status: 201 }); }
  catch (error) { return authErrorResponse(error); }
}
export async function PATCH(request: Request) {
  try { const { user, access } = guard(request); const body = await request.json(); const schedule = updateAgentSchedule(user.id, String(body.id || ""), input(body), access.minIntervalMinutes); markAgentChanged(user.id); void releaseScheduleSessions(user.id, String(body.id || "")).catch(() => undefined); return Response.json({ schedule }); }
  catch (error) { return authErrorResponse(error); }
}
export async function DELETE(request: Request) {
  try { const { user } = guard(request); const body = await request.json(); removeAgentSchedule(user.id, String(body.id || "")); markAgentChanged(user.id); void releaseScheduleSessions(user.id, String(body.id || "")).catch(() => undefined); return new Response(null, { status: 204 }); }
  catch (error) { return authErrorResponse(error); }
}
