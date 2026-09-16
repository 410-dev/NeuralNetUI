import { authErrorResponse, requireAdmin } from "@/lib/auth";
import { deletePlan, savePlan } from "@/lib/plans";
export const runtime="nodejs";export const dynamic="force-dynamic";
type Context={params:Promise<{id:string}>};
export async function PUT(request:Request,context:Context){try{requireAdmin(request);const{id}=await context.params;return Response.json({plan:savePlan(await request.json(),id)});}catch(error){return authErrorResponse(error);}}
export async function DELETE(request:Request,context:Context){try{requireAdmin(request);const{id}=await context.params;deletePlan(id);return Response.json({deleted:true});}catch(error){return authErrorResponse(error);}}
