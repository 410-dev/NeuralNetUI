import { NextResponse } from "next/server";
import { inferModel, readConfig } from "@/lib/config";
import { authErrorResponse, requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    requireAdmin(request);
    const body = await request.json().catch(() => ({}));
    const config = await readConfig();
    const baseUrl = String(body.baseUrl || config.server.baseUrl).replace(/\/$/, "");
    const apiKey = String(body.apiKey || config.server.apiKey || process.env.OPENAI_API_KEY || "");
    const response = await fetch(`${baseUrl}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Server responded with ${response.status}`);
    const payload = await response.json();
    const items = Array.isArray(payload?.data) ? payload.data.filter((item: { id?: string }) => item?.id) : [];
    return NextResponse.json({ models: items.map((item: Record<string, unknown>) => inferModel(item)) });
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) return authErrorResponse(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "서버에 연결할 수 없습니다." },
      { status: 502 },
    );
  }
}
