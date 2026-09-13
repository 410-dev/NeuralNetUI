import { authErrorResponse, requireUser } from "@/lib/auth";
import { cancelStorageUpload } from "@/lib/storage-chunk-upload";

export const runtime="nodejs";export const dynamic="force-dynamic";
export async function DELETE(request:Request,context:{params:Promise<{id:string}>}){try{const user=requireUser(request),{id}=await context.params;await cancelStorageUpload(id,user.id);return new Response(null,{status:204});}catch(error){if(error&&typeof error==="object"&&"status" in error)return authErrorResponse(error);return Response.json({error:"Upload session not found."},{status:404});}}
