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
    const thumbnail = new URL(request.url).searchParams.get("variant") === "thumbnail" && metadata.mimeType.startsWith("image/") && existsSync(paths.thumbnail);
    const stream = Readable.toWeb(createReadStream(thumbnail ? paths.thumbnail : paths.original)) as ReadableStream;
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new Response(stream, { headers: {
      "Content-Type": thumbnail ? "image/jpeg" : metadata.mimeType,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(metadata.name)}`,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch { return Response.json({ error: "Attachment not found." }, { status: 404 }); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const { id } = await context.params; const user = requireUser(request); await deleteUpload(id, user.id); return new Response(null, { status: 204 }); }
  catch { return Response.json({ error: "Attachment deletion failed." }, { status: 400 }); }
}
