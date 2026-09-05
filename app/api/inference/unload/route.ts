import { NextResponse } from "next/server";
import { authErrorResponse, requireAdmin } from "@/lib/auth";
import { readConfig } from "@/lib/config";
import { inferenceEndpoint, loadedModelIdentifier } from "@/lib/inference-control";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    requireAdmin(request);
    const config = await readConfig();
    const apiKey = config.server.apiKey || process.env.OPENAI_API_KEY || "";
    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    };
    const statusResponse = await fetch(inferenceEndpoint(config.server.baseUrl, "status"), {
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

    const response = await fetch(inferenceEndpoint(config.server.baseUrl, "unload"), {
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
