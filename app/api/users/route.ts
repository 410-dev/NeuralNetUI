import { authErrorResponse, createUser, listUsers, requireAdmin } from "@/lib/auth";
import { readConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try { const actor = requireAdmin(request); const config = await readConfig(); return Response.json({ users: listUsers(), currentUserId: actor.id, currentUserCanAudit: actor.canAudit, currentUserRole:actor.role, defaultStorageQuotaBytes: config.userStorageSettings.defaultQuotaBytes, trashRetentionDays:config.userStorageSettings.trashRetentionDays }); }
  catch (error) { return authErrorResponse(error); }
}

export async function POST(request: Request) {
  try { requireAdmin(request); const config = await readConfig(); await createUser(await request.json(), config.userStorageSettings.defaultQuotaBytes); return Response.json({ users: listUsers() }, { status: 201 }); }
  catch (error) { return authErrorResponse(error); }
}
