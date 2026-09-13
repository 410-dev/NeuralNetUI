import { authErrorResponse, requireUser } from "@/lib/auth";
import { beginStorageUpload } from "@/lib/storage-chunk-upload";

export const runtime="nodejs";export const dynamic="force-dynamic";
export async function POST(request:Request){try{const user=requireUser(request);return Response.json(await beginStorageUpload(await request.json(),user.id),{status:201});}catch(error){if(error&&typeof error==="object"&&"status" in error)return authErrorResponse(error);return Response.json({error:error instanceof Error?error.message:"Upload could not be started."},{status:400});}}
