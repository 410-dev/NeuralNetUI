import { authErrorResponse, mergeUserPreference, requireUser } from "@/lib/auth";
import { mergeToolState, normalizeToolState, persistableToolState } from "@/lib/tools/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Saves the composer's tool switches on the account so they survive reloads and other devices. The body is a
 * partial tool state: only the providers it names change. Saved preferences in the older switch format are
 * converted on the first save.
 */
export async function PUT(request: Request) {
  try {
    const user = requireUser(request);
    const body = await request.json().catch(() => ({}));
    const enabledTools = persistableToolState(mergeToolState(normalizeToolState(user.preferences.enabledTools), body));
    mergeUserPreference(user.id, "enabledTools", enabledTools);
    return Response.json({ enabledTools });
  } catch (error) { return authErrorResponse(error); }
}
