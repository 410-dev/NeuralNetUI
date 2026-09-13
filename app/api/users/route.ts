import { authErrorResponse, createUser, listUsers, requireAdmin } from "@/lib/auth";
import { readConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try { const actor=requireAdmin(request);const all=listUsers();const query=new URL(request.url).searchParams;const needle=String(query.get("q")||"").trim().toLocaleLowerCase().slice(0,120);const filtered=needle?all.filter(user=>user.username.toLocaleLowerCase().includes(needle)||user.displayName.toLocaleLowerCase().includes(needle)||user.id.toLocaleLowerCase().includes(needle)):all;const pageSize=10;const pageCount=Math.max(1,Math.ceil(filtered.length/pageSize));const page=Math.max(1,Math.min(pageCount,Math.floor(Number(query.get("page")||1)||1)));const totals=all.reduce((sum,user)=>({storageUsedBytes:sum.storageUsedBytes+user.storageUsedBytes,storageQuotaBytes:sum.storageQuotaBytes+user.storageQuotaBytes,trashUsedBytes:sum.trashUsedBytes+user.trashUsedBytes,trashQuotaBytes:sum.trashQuotaBytes+user.trashQuotaBytes}),{storageUsedBytes:0,storageQuotaBytes:0,trashUsedBytes:0,trashQuotaBytes:0});return Response.json({users:filtered.slice((page-1)*pageSize,page*pageSize),total:filtered.length,page,pageSize,pageCount,query:needle,totals,currentUserId:actor.id,currentUserCanAudit:actor.canAudit,currentUserRole:actor.role}); }
  catch (error) { return authErrorResponse(error); }
}

export async function POST(request: Request) {
  try { requireAdmin(request); const config = await readConfig(); await createUser(await request.json(),{storage:config.userStorageSettings.defaultQuotaBytes,trash:config.userStorageSettings.defaultTrashQuotaBytes}); return Response.json({ created:true }, { status: 201 }); }
  catch (error) { return authErrorResponse(error); }
}
