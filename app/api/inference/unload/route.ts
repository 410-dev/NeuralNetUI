import { NextResponse } from "next/server";
import { authErrorResponse, requireAdmin } from "@/lib/auth";
import { readConfig } from "@/lib/config";
import { inferenceEndpoint, loadedModelIdentifier } from "@/lib/inference-control";
import { connectionForModel, connectionHeaders, lmStudioEndpoint, modelsEndpoint, nnuiModelEndpoint } from "@/lib/connection-drivers";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    requireAdmin(request);
    const { modelId } = await request.json().catch(() => ({})) as { modelId?: string };
    const config = await readConfig();
    const model = config.models.find((candidate) => candidate.id === modelId) || config.models[0];
    if (!model) return NextResponse.json({ ok: true, alreadyUnloaded: true });
    const connection = connectionForModel(config.connections, model);
    if (!connection) throw new Error("The model connection is unavailable.");
    const headers = { Accept: "application/json", ...connectionHeaders(connection, connection.driver === "openai" ? process.env.OPENAI_API_KEY : "") };
    if (connection.driver === "nnui") {
      const response = await fetch(nnuiModelEndpoint(connection.baseUrl, model.sourceModel, "unload"), { method: "POST", headers, signal: AbortSignal.timeout(300_000), cache: "no-store" });
      const detail = await response.text();
      if (!response.ok) throw new Error(detail || `NNUI model unload failed with ${response.status}`);
      return NextResponse.json({ ok: true });
    }
    if (connection.driver === "lmstudio") {
      const listResponse = await fetch(modelsEndpoint("lmstudio", connection.baseUrl), { headers, signal: AbortSignal.timeout(30_000), cache: "no-store" });
      if (!listResponse.ok) throw new Error((await listResponse.text()) || `Model list failed with ${listResponse.status}`);
      const payload = await listResponse.json() as { models?: Array<{ key?: string; loaded_instances?: Array<{ id?: string }> }> };
      const remote = payload.models?.find((candidate) => candidate.key === model.sourceModel || candidate.key === model.id);
      const instanceIds = (remote?.loaded_instances || []).map((instance) => instance.id).filter((id): id is string => Boolean(id));
      if (!instanceIds.length) return NextResponse.json({ ok: true, alreadyUnloaded: true });
      for (const instanceId of instanceIds) { const response = await fetch(lmStudioEndpoint(connection.baseUrl, "unload"), { method: "POST", headers, body: JSON.stringify({ instance_id: instanceId }), signal: AbortSignal.timeout(300_000), cache: "no-store" }); if (!response.ok) throw new Error((await response.text()) || `Model unload failed with ${response.status}`); }
      return NextResponse.json({ ok: true });
    }
    const statusResponse = await fetch(inferenceEndpoint(connection.baseUrl, "status"), {
      headers,
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    const statusDetail = await statusResponse.text();
    if (!statusResponse.ok) throw new Error(statusDetail || `Model status failed with ${statusResponse.status}`);
    let status: unknown;
    try { status = JSON.parse(statusDetail); }
    catch { throw new Error("The inference server returned an invalid model status response."); }
    const modelPath = loadedModelIdentifier(status);
    if (!modelPath) return NextResponse.json({ ok: true, alreadyUnloaded: true });

    const response = await fetch(inferenceEndpoint(connection.baseUrl, "unload"), {
      method: "POST",
      headers,
      body: JSON.stringify({ model_path: modelPath }),
      signal: AbortSignal.timeout(300_000),
      cache: "no-store",
    });
    const detail = await response.text();
    if (!response.ok) throw new Error(detail || `Model unload failed with ${response.status}`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) return authErrorResponse(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "모델을 언로드하지 못했습니다." },
      { status: 502 },
    );
  }
}
