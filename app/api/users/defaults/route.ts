import { authErrorResponse, requireAdmin } from "@/lib/auth";
import { readConfig, writeConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  try {
    requireAdmin(request);
    const body = await request.json();
    const current = await readConfig();
    const bytes = body.defaultStorageQuotaBytes===undefined?current.userStorageSettings.defaultQuotaBytes:Number(body.defaultStorageQuotaBytes);const trashBytes=body.defaultTrashQuotaBytes===undefined?current.userStorageSettings.defaultTrashQuotaBytes:Number(body.defaultTrashQuotaBytes);const retentionDays=body.trashRetentionDays===undefined?current.userStorageSettings.trashRetentionDays:Number(body.trashRetentionDays);
    if (!Number.isSafeInteger(bytes) || bytes < 1024 * 1024 || bytes > 10 * 1024 ** 4) return Response.json({ error: "저장소 기본 할당량은 1MB~10TB 사이여야 합니다." }, { status: 400 });
    if (!Number.isSafeInteger(trashBytes) || trashBytes < 1024 * 1024 || trashBytes > 20 * 1024 ** 4) return Response.json({ error: "휴지통 기본 할당량은 1MB~20TB 사이여야 합니다." }, { status: 400 });
    if(!Number.isSafeInteger(retentionDays)||retentionDays<1||retentionDays>60)return Response.json({error:"삭제 보존 기간은 1~60일 사이여야 합니다."},{status:400});
    const saved = await writeConfig({ ...current, userStorageSettings: { defaultQuotaBytes: bytes,defaultTrashQuotaBytes:trashBytes,trashRetentionDays:retentionDays } });
    return Response.json({ defaultStorageQuotaBytes:saved.userStorageSettings.defaultQuotaBytes,defaultTrashQuotaBytes:saved.userStorageSettings.defaultTrashQuotaBytes,trashRetentionDays:saved.userStorageSettings.trashRetentionDays });
  } catch (error) { return authErrorResponse(error); }
}
