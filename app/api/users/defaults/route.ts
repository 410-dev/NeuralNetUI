import { authErrorResponse, requireAdmin } from "@/lib/auth";
import { readConfig, writeConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  try {
    requireAdmin(request);
    const body = await request.json();
    const bytes = Number(body.defaultStorageQuotaBytes);
    if (!Number.isSafeInteger(bytes) || bytes < 1024 * 1024 || bytes > 10 * 1024 ** 4) return Response.json({ error: "저장소 기본 할당량은 1MB~10TB 사이여야 합니다." }, { status: 400 });
    const current = await readConfig();
    const saved = await writeConfig({ ...current, userStorageSettings: { defaultQuotaBytes: bytes } });
    return Response.json({ defaultStorageQuotaBytes: saved.userStorageSettings.defaultQuotaBytes });
  } catch (error) { return authErrorResponse(error); }
}
