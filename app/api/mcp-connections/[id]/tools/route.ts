import { authErrorResponse, requireUser } from "@/lib/auth";
import { listMcpTools, saveMcpToolPolicies } from "@/lib/mcp";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(request:Request,context:{params:Promise<{id:string}>}){
  try{const user=requireUser(request),{id}=await context.params;return Response.json({tools:await listMcpTools(user.id,id,request.signal)});}
  catch(error){return authErrorResponse(error);}
}

export async function PUT(request:Request,context:{params:Promise<{id:string}>}){
  try{const user=requireUser(request),{id}=await context.params;return Response.json(saveMcpToolPolicies(user.id,id,await request.json()));}
  catch(error){return authErrorResponse(error);}
}
