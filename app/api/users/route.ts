import { authErrorResponse, createUser, listUsers, requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try { const actor = requireAdmin(request); return Response.json({ users: listUsers(), currentUserId: actor.id }); }
  catch (error) { return authErrorResponse(error); }
}

export async function POST(request: Request) {
  try { requireAdmin(request); await createUser(await request.json()); return Response.json({ users: listUsers() }, { status: 201 }); }
  catch (error) { return authErrorResponse(error); }
}
