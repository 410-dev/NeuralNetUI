import { authErrorResponse, requireUser } from "@/lib/auth";
import { conversationsReferencingUpload } from "@/lib/conversations";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(request:Request,context:{params:Promise<{id:string}>}){
  try{const user=requireUser(request);const{id}=await context.params;return Response.json({conversations:await conversationsReferencingUpload(id,user.id)});}
  catch(error){return authErrorResponse(error);}
}
