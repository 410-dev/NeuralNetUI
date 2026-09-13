import { authErrorResponse, requireUser } from "@/lib/auth";
import { completeStorageUpload } from "@/lib/storage-chunk-upload";

export const runtime="nodejs";export const dynamic="force-dynamic";
export async function POST(request:Request,context:{params:Promise<{id:string}>}){try{const user=requireUser(request),{id}=await context.params;return Response.json({attachment:await completeStorageUpload(id,user.id)},{status:201});}catch(error){if(error&&typeof error==="object"&&"status" in error)return authErrorResponse(error);return Response.json({error:error instanceof Error?error.message:"Upload could not be completed."},{status:400});}}
