import { getUser, setupRequired } from "@/lib/auth";
import { ensureRetentionMaintenanceScheduled } from "@/lib/retention-maintenance";
import { accentColorOf, DEFAULT_LOGIN_APPEARANCE } from "@/lib/appearance";
import { readConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  ensureRetentionMaintenanceScheduled();
  const user = getUser(request);
  // The sign-in screen paints itself before any account exists, so the workspace accent for it
  // travels with the unauthenticated status rather than the per-user configuration.
  let loginAccent = accentColorOf(DEFAULT_LOGIN_APPEARANCE);
  try { loginAccent = accentColorOf((await readConfig()).loginAppearance); }
  catch (error) { console.error("Unable to read the sign-in accent", error); }
  return Response.json({
    setupRequired: setupRequired(),
    authenticated: Boolean(user),
    loginAccent,
    user: user ? { id: user.id, username: user.username, displayName: user.displayName, role: user.role, canAudit:user.canAudit } : null,
  });
}
