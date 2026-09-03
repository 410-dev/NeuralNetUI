import { NextResponse } from "next/server";
import { authErrorResponse, requireAdmin } from "@/lib/auth";
import { readConfig } from "@/lib/config";
import { inferenceEndpoint } from "@/lib/inference-control";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    requireAdmin(request);
    const config = await readConfig();
    const apiKey = config.server.apiKey || process.env.OPENAI_API_KEY || "";
    const response = await fetch(inferenceEndpoint(config.server.baseUrl, "unload"), {
      method: "POST",
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(30_000),
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
