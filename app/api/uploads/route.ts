import { NextResponse } from "next/server";
import { cleanupOrphanedUploads, deleteUpload, saveUpload } from "@/lib/uploads";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { readConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = requireUser(request);
    const settings = (await readConfig()).toolSettings;
    const form = await request.formData();
    const files = form.getAll("files").filter((value): value is File => value instanceof File);
    if (!files.length) return NextResponse.json({ error: "No files were selected." }, { status: 400 });
    if (files.length > settings.maxAttachmentsPerMessage) return NextResponse.json({ error: `You can attach up to ${settings.maxAttachmentsPerMessage} files at once.` }, { status: 400 });
    await cleanupOrphanedUploads(settings);
    const attachments = [];
    try {
      for (const [index, file] of files.entries()) {
        const thumbnailValue = form.get(`thumbnail-${index}`);
        const thumbnail = thumbnailValue instanceof File && thumbnailValue.size ? thumbnailValue : undefined;
        let dimensions: { width?: number; height?: number } = {};
        try { dimensions = JSON.parse(String(form.get(`dimensions-${index}`) || "{}")); } catch { /* Use empty dimensions. */ }
        attachments.push(await saveUpload(file, thumbnail, user.id, settings, dimensions));
      }
    } catch (error) {
      await Promise.all(attachments.map((attachment) => deleteUpload(attachment.id, user.id).catch(() => undefined)));
      throw error;
    }
    return NextResponse.json({ attachments }, { status: 201 });
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) return authErrorResponse(error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "File upload failed." }, { status: 400 });
  }
}
