import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { canUseModel, inferModel, readConfig, writeConfig } from "@/lib/config";
import { baseModelForAlias, inferApiContextWindowTokens } from "@/lib/model-context";
import { connectionForModel, modelsEndpoint } from "@/lib/connection-drivers";
import { aliasBaseModel } from "@/lib/alias-base-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function identifierWithoutVariant(value: string) {
  const separator = value.lastIndexOf(":");
  const lastPathSeparator = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
  return separator > lastPathSeparator && separator !== 1 ? value.slice(0, separator) : value;
}

export async function POST(request: Request) {
  try {
    const user = requireUser(request);
    const { modelId, aliasBaseModelId } = await request.json().catch(() => ({})) as { modelId?: string; aliasBaseModelId?: string };
    const config = await readConfig();
    const requested = config.models.find((model) => model.id === modelId && canUseModel(model, user));
    if (!requested) return NextResponse.json({ error: "선택한 모델을 사용할 수 없습니다." }, { status: 400 });
    const base = aliasBaseModel(requested, config.models, aliasBaseModelId) || baseModelForAlias(requested, config.models) || requested;

    const connection = connectionForModel(config.connections, base);
    if (!connection) return NextResponse.json({ error: "모델 연결을 찾을 수 없습니다." }, { status: 404 });
    const apiKey = connection.clearApiKey ? "" : connection.apiKey || (connection.driver === "openai" ? process.env.OPENAI_API_KEY : "") || "";
    const response = await fetch(modelsEndpoint(connection.driver, connection.baseUrl), {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Server responded with ${response.status}`);
    const payload = await response.json();
    const rawRecords = connection.driver === "lmstudio" ? payload?.models : payload?.data;
    const records = Array.isArray(rawRecords) ? rawRecords.filter((item: { id?: string; key?: string }) => item?.id || item?.key) as Array<Record<string, unknown>> : [];
    const targetIdentifier = identifierWithoutVariant(base.sourceModel);
    const record = records.find((candidate) => {
      const inferred = inferModel(candidate, connection.driver, connection.id);
      return inferred.id === base.id
        || inferred.sourceModel === base.sourceModel
        || identifierWithoutVariant(inferred.sourceModel) === targetIdentifier;
    });
    if (!record) return NextResponse.json({ error: "서버 모델 목록에서 선택한 모델을 찾을 수 없습니다." }, { status: 404 });

    const apiContextWindowTokens = inferApiContextWindowTokens(record);
    const latest = await readConfig();
    const latestRequested = latest.models.find((model) => model.id === requested.id);
    const latestBase = aliasBaseModel(latestRequested, latest.models, aliasBaseModelId) || baseModelForAlias(latestRequested, latest.models) || latestRequested;
    if (!latestBase) return NextResponse.json({ error: "모델 설정이 변경되었습니다." }, { status: 409 });
    await writeConfig({
      ...latest,
      models: latest.models.map((model) => {
        if (model.id === latestBase.id) return { ...model, apiContextWindowTokens };
        if (model.isAlias && (model.sourceModel === latestBase.sourceModel || model.sourceModel === latestBase.id)) {
          return { ...model, apiContextWindowTokens: undefined };
        }
        return model;
      }),
    });
    return NextResponse.json({ modelId: latestBase.id, apiContextWindowTokens: apiContextWindowTokens ?? null });
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) return authErrorResponse(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "컨텍스트 윈도우를 갱신하지 못했습니다." },
      { status: 502 },
    );
  }
}
