import { authErrorResponse, requireUser } from "@/lib/auth";
import { deleteUpload, storageSummary } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try { const user = requireUser(request); return Response.json(await storageSummary(user.id)); }
  catch (error) { return authErrorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const user = requireUser(request); const body = await request.json();
    const ids: string[] = Array.isArray(body.ids) ? [...new Set<string>(body.ids.map((value:unknown)=>String(value)))].slice(0, 100) : [];
    if (!ids.length) return Response.json({ error: "No files were selected." }, { status: 400 });
    for (const id of ids) await deleteUpload(id, user.id);
    return Response.json(await storageSummary(user.id));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Storage operation failed." }, { status: 400 }); }
}
