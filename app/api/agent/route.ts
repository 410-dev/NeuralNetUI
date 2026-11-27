import { authErrorResponse, requireUser } from "@/lib/auth";
import { agentAccess, agentRevision, ensureAgent, ensureAgentScheduler, updateAgentSettings } from "@/lib/agent/runtime";
import { listAgentItems, listAgentRuns, listAgentSchedules, normalizeAgentSettings, readAgentProfile } from "@/lib/agent/store";
import { getChatJob } from "@/lib/chat-runtime";
import { pushDeviceCount, vapidPublicKey } from "@/lib/agent/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Everything the agent screen shows: settings, main chat, active subagents, schedules and the next periodic check. */
export async function GET(request: Request) {
  try {
    const user = requireUser(request); ensureAgentScheduler();
    const access = agentAccess(user.id);
    if (!access.enabled) return Response.json({ access });
    const language = new URL(request.url).searchParams.get("language") === "en" ? "en" : "ko";
    const profile = readAgentProfile(user.id) ?? await ensureAgent(user.id, language);
    const job = getChatJob(profile.conversationId, user.id);
    const schedules = listAgentSchedules(user.id);
    return Response.json({
      access, revision: agentRevision(user.id), conversationId: profile.conversationId, settings: profile.settings,
      mainBusy: Boolean(job && (job.status === "running" || job.status === "waiting")),
      nextHeartbeatAt: profile.settings.enabled ? profile.nextHeartbeatAt ?? null : null, lastHeartbeatAt: profile.lastHeartbeatAt ?? null,
      activeRuns: listAgentRuns(user.id, { status: "active", limit: 50 }).runs,
      reminders: schedules.filter(item => item.kind === "once" && item.enabled),
      recurring: schedules.filter(item => item.kind === "recurring"),
      counts: { memories: listAgentItems(user.id, "memory").length, events: listAgentItems(user.id, "event").length, todos: listAgentItems(user.id, "todo").filter(item => item.status !== "done").length },
      push: { publicKey: vapidPublicKey(), devices: pushDeviceCount(user.id) },
    });
  } catch (error) { return authErrorResponse(error); }
}

/** Saves the agent's own settings. */
export async function PATCH(request: Request) {
  try {
    const user = requireUser(request);
    if (!agentAccess(user.id).enabled) return Response.json({ error: "The agent is not available on this plan." }, { status: 403 });
    const profile = readAgentProfile(user.id) ?? await ensureAgent(user.id);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const allowed = ["enabled", "modelId", "aliasBaseModelId", "reasoningPresetId", "subagentModelId", "heartbeatMinutes", "instructions", "mainPrompt", "compactPercent", "toolTimeoutMinutes", "toolState", "toolRules", "timeZone", "locale", "language"];
    const merged = normalizeAgentSettings({ ...profile.settings, ...Object.fromEntries(Object.entries(body).filter(([key]) => allowed.includes(key))) });
    const saved = updateAgentSettings(user.id, merged);
    // An emptied choice clears the saved one, which a merge would otherwise keep.
    if ("subagentModelId" in body && !body.subagentModelId && saved.settings.subagentModelId) { const { saveAgentSettings } = await import("@/lib/agent/store"); saveAgentSettings(user.id, { ...saved.settings, subagentModelId: undefined }); return Response.json({ settings: { ...saved.settings, subagentModelId: undefined } }); }
    return Response.json({ settings: saved.settings });
  } catch (error) { return authErrorResponse(error); }
}
