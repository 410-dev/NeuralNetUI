import { authErrorResponse, createFirstUser, createSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const id = await createFirstUser(await request.json());
    return Response.json({ ok: true }, { status: 201, headers: { "Set-Cookie": createSession(id, request) } });
  } catch (error) { return authErrorResponse(error); }
}
