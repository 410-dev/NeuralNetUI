import { getUser, setupRequired } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = getUser(request);
  return Response.json({
    setupRequired: setupRequired(),
    authenticated: Boolean(user),
    user: user ? { id: user.id, username: user.username, displayName: user.displayName, role: user.role } : null,
  });
}
