import {
  authErrorResponse,
  deleteManagedUser,
  requireAdmin,
  updateManagedUser,
} from "@/lib/auth";
import { readConfig } from "@/lib/config";
import { purgeDeletedUploads } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const actor = requireAdmin(request);
    const { id } = await context.params;
    const config=await readConfig();updateManagedUser(actor,id,await request.json(),{storage:config.userStorageSettings.defaultQuotaBytes,trash:config.userStorageSettings.defaultTrashQuotaBytes});
    await purgeDeletedUploads(id,config.userStorageSettings.trashRetentionDays);
    return Response.json({ updated:true });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const actor = requireAdmin(request);
    const { id } = await context.params;
    await deleteManagedUser(actor, id);
    return Response.json({ deleted:true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
