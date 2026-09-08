import { NextResponse } from "next/server";
import { inferModel, readConfig } from "@/lib/config";
import { authErrorResponse, requireAdmin } from "@/lib/auth";
import { discoverModelRecords } from "@/lib/model-discovery";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    requireAdmin(request);
    const body = await request.json().catch(() => ({}));
    const config = await readConfig();
    const saved = config.connections.find((connection) => connection.id === body.id);
    const driver = body.driver === "lmstudio" ? "lmstudio" : "openai";
    const baseUrl = String(body.baseUrl || saved?.baseUrl || "");
    const apiKey = (body.clearApiKey ?? saved?.clearApiKey) ? "" : String(body.apiKey || saved?.apiKey || (driver === "openai" ? process.env.OPENAI_API_KEY : "") || "");
    const items = await discoverModelRecords(driver, baseUrl, apiKey);
    return NextResponse.json({ models: items.map((item: Record<string, unknown>) => inferModel(item, driver, String(body.id || saved?.id || ""))) });
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) return authErrorResponse(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "서버에 연결할 수 없습니다." },
      { status: 502 },
    );
  }
}
