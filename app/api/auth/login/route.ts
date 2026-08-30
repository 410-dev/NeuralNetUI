import { authenticate, authErrorResponse, createSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const user = await authenticate(String(body.username || ""), String(body.password || ""));
    return Response.json({ user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role } }, { headers: { "Set-Cookie": createSession(user.id, request) } });
  } catch (error) { return authErrorResponse(error); }
}
