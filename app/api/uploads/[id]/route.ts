import { createReadStream, existsSync } from "node:fs";
import { Readable } from "node:stream";
import { deleteUpload, readUpload } from "@/lib/uploads";
import { requireUser } from "@/lib/auth";

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
  try { const { id } = await context.params; const user = requireUser(request); await deleteUpload(id, user.id); return new Response(null, { status: 204 }); }
  catch { return Response.json({ error: "Attachment deletion failed." }, { status: 400 }); }
}
