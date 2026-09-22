import { createReadStream, existsSync } from "node:fs";
import { Readable } from "node:stream";
import { deleteUpload, purgeDeletedUploads, readUpload, replaceStoredTextFile } from "@/lib/uploads";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { readConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const user = requireUser(request);
    const { metadata, paths } = await readUpload(id, user.id);
    const query = new URL(request.url).searchParams;
    const thumbnail = query.get("variant") === "thumbnail" && metadata.mimeType.startsWith("image/") && existsSync(paths.thumbnail);
    const stream = Readable.toWeb(createReadStream(thumbnail ? paths.thumbnail : paths.original)) as ReadableStream;
    const safeInline = metadata.mimeType.startsWith("image/") || metadata.mimeType === "application/pdf";
    const download = query.get("download") === "1" || !safeInline;
    return new Response(stream, { headers: {
      "Content-Type": thumbnail ? "image/jpeg" : metadata.mimeType,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(metadata.name)}`,
      "Cache-Control": "private, no-store",
      "Vary": "Cookie",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch { return Response.json({ error: "Attachment not found." }, { status: 404 }); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const { id } = await context.params; const user = requireUser(request); await deleteUpload(id, user.id);const config=await readConfig();await purgeDeletedUploads(user.id,config.userStorageSettings.trashRetentionDays);return new Response(null, { status: 204 }); }
  catch { return Response.json({ error: "Attachment deletion failed." }, { status: 400 }); }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const declared=Number(request.headers.get("content-length")||0);
    if(declared>20*1024*1024)return Response.json({error:"Edited files are limited to 16 MB."},{status:413});
    const {id}=await context.params,user=requireUser(request),body=await request.json();
    if(typeof body.content!=="string")return Response.json({error:"File content must be text."},{status:400});
    const content=body.content;
    if(Buffer.byteLength(content,"utf8")>16*1024*1024)return Response.json({error:"Edited files are limited to 16 MB."},{status:413});
    return Response.json({attachment:await replaceStoredTextFile(id,user.id,content)});
  } catch(error) {
    if(error&&typeof error==="object"&&"status" in error)return authErrorResponse(error);
    const message=error instanceof Error?error.message:"File update failed.";
    return Response.json({error:message},{status:/not found/i.test(message)?404:400});
  }
}
