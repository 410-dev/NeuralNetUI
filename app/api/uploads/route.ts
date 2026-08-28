import { NextResponse } from "next/server";
import { saveUpload } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const files = form.getAll("files").filter((value): value is File => value instanceof File);
    const thumbnails = form.getAll("thumbnails").filter((value): value is File => value instanceof File);
    const dimensions = form.getAll("dimensions").map((value) => {
      try { return JSON.parse(String(value)) as { width?: number; height?: number }; } catch { return {}; }
    });
    if (!files.length) return NextResponse.json({ error: "No images were selected." }, { status: 400 });
    if (files.length > 12) return NextResponse.json({ error: "You can attach up to 12 images at once." }, { status: 400 });
    if (files.length !== thumbnails.length) return NextResponse.json({ error: "Thumbnail count does not match." }, { status: 400 });
    const attachments = await Promise.all(files.map((file, index) => saveUpload(file, thumbnails[index], dimensions[index])));
    return NextResponse.json({ attachments }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Image upload failed." }, { status: 400 });
  }
}
