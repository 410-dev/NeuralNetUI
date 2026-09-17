import { authErrorResponse, mergeUserPreference, requireUser } from "@/lib/auth";
import { normalizeEnabledTools } from "@/lib/enabled-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Saves the composer's tool switches on the account so they survive reloads and other devices. */
export async function PUT(request: Request) {
  try {
    const user = requireUser(request);
    const body = await request.json().catch(() => ({}));
    const enabledTools = normalizeEnabledTools({ ...normalizeEnabledTools(user.preferences.enabledTools), ...(body && typeof body === "object" ? body : {}) });
    mergeUserPreference(user.id, "enabledTools", enabledTools);
    return Response.json({ enabledTools });
  } catch (error) { return authErrorResponse(error); }
}
