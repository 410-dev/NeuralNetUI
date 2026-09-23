import { AuthError, authErrorResponse, listUsers, logAdminAudit, requireAdmin } from "@/lib/auth";
import { releasePlanAdmission } from "@/lib/plans";

export const runtime="nodejs";
export const dynamic="force-dynamic";

type Context={params:Promise<{id:string}>};

/** Administrators can clear a stranded per-account response admission after a failed shutdown. */
export async function POST(request:Request,context:Context){
  try{
    const actor=requireAdmin(request),{id}=await context.params;
    if(!listUsers().some(user=>user.id===id))throw new AuthError("사용자를 찾을 수 없습니다.",404);
    const released=releasePlanAdmission(id);
    logAdminAudit(actor.id,id,"user.response-admission.release",JSON.stringify({released}));
    return Response.json({released});
  }catch(error){return authErrorResponse(error);}
}
