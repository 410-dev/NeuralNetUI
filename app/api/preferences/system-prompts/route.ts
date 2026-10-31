import { NextResponse } from "next/server";
import { mergeUserPreference, requireUser, authErrorResponse } from "@/lib/auth";
import { publicConfig, readConfig } from "@/lib/config";
import { MAX_SYSTEM_PROMPT_OVERRIDE_LENGTH, readSystemPromptOverrides, systemPromptEditable, withSystemPromptOverride } from "@/lib/system-prompt";

export const dynamic = "force-dynamic";

/**
 * Saves, or with `prompt: null` removes, one account's own system prompt for a model and reasoning preset.
 * The shared model is never changed; served models accept this only while an administrator allows it.
 */
export async function PUT(request: Request) {
  try {
    const user = requireUser(request);
    const body = await request.json().catch(() => ({})) as { modelId?: unknown; presetId?: unknown; prompt?: unknown };
    const modelId = typeof body.modelId === "string" ? body.modelId : "";
    const presetId = typeof body.presetId === "string" && body.presetId ? body.presetId : undefined;
    const prompt = body.prompt === null ? null : typeof body.prompt === "string" ? body.prompt : undefined;
    const ko = user.preferences.language === "ko";
    if (prompt === undefined) return NextResponse.json({ error: ko ? "시스템 프롬프트가 올바르지 않습니다." : "The system prompt is invalid." }, { status: 400 });
    if (prompt && prompt.length > MAX_SYSTEM_PROMPT_OVERRIDE_LENGTH) return NextResponse.json({ error: ko ? "시스템 프롬프트가 너무 깁니다." : "The system prompt is too long." }, { status: 400 });
    const config = await readConfig();
    const visible = publicConfig(config, user);
    const model = visible.models.find(item => item.id === modelId);
    if (!model || !systemPromptEditable(model)) return NextResponse.json({ error: ko ? "이 모델의 시스템 프롬프트는 편집할 수 없습니다." : "This model's system prompt cannot be edited." }, { status: 403 });
    // An alias also offers its runtime base's built-in levels, so the preset is not checked against the definition;
    // a key that matches no preset is simply never used.
    if (presetId && presetId.length > 200) return NextResponse.json({ error: ko ? "선택한 추론 프리셋을 찾을 수 없습니다." : "The selected reasoning preset was not found." }, { status: 400 });
    const systemPromptOverrides = withSystemPromptOverride(readSystemPromptOverrides(user.preferences.systemPromptOverrides), model.id, presetId, prompt);
    mergeUserPreference(user.id, "systemPromptOverrides", systemPromptOverrides);
    return NextResponse.json(publicConfig(config, { ...user, preferences: { ...user.preferences, systemPromptOverrides } }));
  } catch (error) { return authErrorResponse(error); }
}
