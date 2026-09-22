import { NextResponse } from "next/server";
import { mergeUserPreference, requireUser, authErrorResponse } from "@/lib/auth";
import { publicConfig, readConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

/** Saves one account's preferred served model for an alias without changing the shared alias. */
export async function PUT(request: Request) {
  try {
    const user = requireUser(request);
    const body = await request.json().catch(() => ({})) as { aliasId?: unknown; baseModelId?: unknown };
    const aliasId = typeof body.aliasId === "string" ? body.aliasId : "";
    const baseModelId = typeof body.baseModelId === "string" ? body.baseModelId : "";
    const config = await readConfig();
    const visible = publicConfig(config, user);
    const alias = visible.models.find(model => model.id === aliasId && model.isAlias);
    const base = visible.models.find(model => model.id === baseModelId && !model.isAlias && model.visible !== false);
    if (!alias || !base) return NextResponse.json({ error: "선택한 별칭 또는 기반 모델을 사용할 수 없습니다." }, { status: 400 });
    const current = visible.preferences.aliasBaseModelIds || {};
    const aliasBaseModelIds = { ...current, [alias.id]: base.id };
    mergeUserPreference(user.id, "aliasBaseModelIds", aliasBaseModelIds);
    return NextResponse.json(publicConfig(config, { ...user, preferences: { ...user.preferences, aliasBaseModelIds } }));
  } catch (error) { return authErrorResponse(error); }
}
