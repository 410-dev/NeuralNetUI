import { authErrorResponse, requireUser } from "@/lib/auth";
import { saveTextFile } from "@/lib/uploads";

export const runtime="nodejs";export const dynamic="force-dynamic";
export async function POST(request:Request){try{const user=requireUser(request),body=await request.json();const kind=body.kind==="markdown"?"markdown":body.kind==="text"?"text":undefined;if(!kind)return Response.json({error:"File type must be Markdown or text."},{status:400});const content=String(body.content??"");if(Buffer.byteLength(content,"utf8")>16*1024*1024)return Response.json({error:"Created files are limited to 16 MB."},{status:413});return Response.json({attachment:await saveTextFile(String(body.name||""),kind,content,user.id)},{status:201});}catch(error){if(error&&typeof error==="object"&&"status" in error)return authErrorResponse(error);return Response.json({error:error instanceof Error?error.message:"File creation failed."},{status:400});}}
