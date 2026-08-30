import {
  authErrorResponse,
  deleteManagedUser,
  listUsers,
  requireAdmin,
  updateManagedUser,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const actor = requireAdmin(request);
    const { id } = await context.params;
    updateManagedUser(actor, id, await request.json());
    return Response.json({ users: listUsers() });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const actor = requireAdmin(request);
    const { id } = await context.params;
    await deleteManagedUser(actor, id);
    return Response.json({ users: listUsers() });
  } catch (error) {
    return authErrorResponse(error);
  }
}
