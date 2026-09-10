import { NextResponse } from "next/server";
import { applyGlobalDefault, publicConfig } from "@/lib/config";
import { authErrorResponse, requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Applies one default model or reasoning level to every account. Administrators only. */
export async function PUT(request: Request) {
  try {
    const user = requireAdmin(request);
    const body = await request.json() as { kind?: unknown; id?: unknown };
    const kind = body.kind === "model" || body.kind === "reasoning" ? body.kind : undefined;
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!kind || !id) return NextResponse.json({ error: "적용할 항목을 확인해 주세요." }, { status: 400 });
    const saved = await applyGlobalDefault(kind, id);
    return NextResponse.json(publicConfig(saved, { ...user, preferences: { ...user.preferences, [kind === "model" ? "defaultModelId" : "defaultReasoningPresetId"]: id } }));
  } catch (error) { return authErrorResponse(error); }
}
