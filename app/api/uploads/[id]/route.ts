import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { deleteUpload, readUpload } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { metadata, paths } = await readUpload(id);
    const thumbnail = new URL(request.url).searchParams.get("variant") === "thumbnail";
    const stream = Readable.toWeb(createReadStream(thumbnail ? paths.thumbnail : paths.original)) as ReadableStream;
    return new Response(stream, { headers: {
      "Content-Type": thumbnail ? "image/jpeg" : metadata.mimeType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(metadata.name)}`,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch { return Response.json({ error: "Image not found." }, { status: 404 }); }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  try { const { id } = await context.params; await deleteUpload(id); return new Response(null, { status: 204 }); }
  catch { return Response.json({ error: "Image deletion failed." }, { status: 400 }); }
}
