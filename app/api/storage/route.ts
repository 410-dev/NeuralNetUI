import { authErrorResponse, requireUser } from "@/lib/auth";
import { moveUploadsToTrash, purgeDeletedUploads, storagePage, type StorageSort } from "@/lib/uploads";
import { readConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try { const user = requireUser(request);const query=new URL(request.url).searchParams;const config=await readConfig();await purgeDeletedUploads(user.id,config.userStorageSettings.trashRetentionDays);const result=await storagePage(user.id,{page:Number(query.get("page")||1),pageSize:Number(query.get("pageSize")||24),sort:String(query.get("sort")||"created_desc") as StorageSort,query:String(query.get("q")||""),state:"active",attachableOnly:query.get("attachable")==="1"});const{trashQuotaBytes:_trashQuotaBytes,trashUsedBytes:_trashUsedBytes,...visible}=result;return Response.json(visible); }
  catch (error) { return authErrorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const user = requireUser(request); const body = await request.json();
    const ids: string[] = Array.isArray(body.ids) ? [...new Set<string>(body.ids.map((value:unknown)=>String(value)))].slice(0, 100) : [];
    if (!ids.length) return Response.json({ error: "No files were selected." }, { status: 400 });
    await moveUploadsToTrash(ids, user.id);
    const config=await readConfig();await purgeDeletedUploads(user.id,config.userStorageSettings.trashRetentionDays);
    const result=await storagePage(user.id,{page:Number(body.page||1),pageSize:Number(body.pageSize||24),sort:String(body.sort||"created_desc") as StorageSort,query:String(body.query||""),state:"active"});const{trashQuotaBytes:_trashQuotaBytes,trashUsedBytes:_trashUsedBytes,...visible}=result;return Response.json(visible);
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Storage operation failed." }, { status: 400 }); }
}
