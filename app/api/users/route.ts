import { authErrorResponse, createUser, listUsers, requireAdmin } from "@/lib/auth";
import { readConfig } from "@/lib/config";
import { listPlans } from "@/lib/plans";
import type { UserSummary } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UserSort = "name" | "username" | "created" | "plan" | "role";
const roleRank: Record<string, number> = { superadmin: 0, admin: 1, user: 2 };

export async function GET(request: Request) {
  try { const actor=requireAdmin(request);const all=listUsers();const query=new URL(request.url).searchParams;const needle=String(query.get("q")||"").trim().toLocaleLowerCase().slice(0,120);const planFilter=String(query.get("planId")||"");const sort=(["name","username","created","plan","role"].includes(String(query.get("sort")))?query.get("sort"):"") as UserSort|"";const descending=query.get("dir")==="desc";let filtered=needle?all.filter(user=>user.username.toLocaleLowerCase().includes(needle)||user.displayName.toLocaleLowerCase().includes(needle)||user.id.toLocaleLowerCase().includes(needle)):all;if(planFilter)filtered=filtered.filter(user=>user.planId===planFilter);if(sort){const planNames=new Map(listPlans().map(plan=>[plan.id,plan.name]));const key=(user:UserSummary)=>sort==="name"?user.displayName:sort==="username"?user.username:sort==="created"?user.createdAt:sort==="plan"?planNames.get(user.planId||"")||"":String(roleRank[user.role]??9);filtered=[...filtered].sort((a,b)=>(key(a).localeCompare(key(b),undefined,{numeric:true,sensitivity:"base"})||a.username.localeCompare(b.username))*(descending?-1:1));}
    // Bulk selection needs every match, not one page; return identities only.
    if(query.get("all")==="1")return Response.json({users:filtered.slice(0,10000).map(user=>({id:user.id,username:user.username,displayName:user.displayName})),total:filtered.length});
    const pageSize=10;const pageCount=Math.max(1,Math.ceil(filtered.length/pageSize));const page=Math.max(1,Math.min(pageCount,Math.floor(Number(query.get("page")||1)||1)));const totals=all.reduce((sum,user)=>({storageUsedBytes:sum.storageUsedBytes+user.storageUsedBytes,storageQuotaBytes:sum.storageQuotaBytes+user.storageQuotaBytes,trashUsedBytes:sum.trashUsedBytes+user.trashUsedBytes,trashQuotaBytes:sum.trashQuotaBytes+user.trashQuotaBytes}),{storageUsedBytes:0,storageQuotaBytes:0,trashUsedBytes:0,trashQuotaBytes:0});return Response.json({users:filtered.slice((page-1)*pageSize,page*pageSize),total:filtered.length,page,pageSize,pageCount,query:needle,totals,currentUserId:actor.id,currentUserCanAudit:actor.canAudit,currentUserRole:actor.role}); }
  catch (error) { return authErrorResponse(error); }
}

export async function POST(request: Request) {
  try { requireAdmin(request); const config = await readConfig(); await createUser(await request.json(),{storage:config.userStorageSettings.defaultQuotaBytes,trash:config.userStorageSettings.defaultTrashQuotaBytes}); return Response.json({ created:true }, { status: 201 }); }
  catch (error) { return authErrorResponse(error); }
}
