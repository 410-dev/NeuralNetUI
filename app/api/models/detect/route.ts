import { NextResponse } from "next/server";
import { inferModel, readConfig } from "@/lib/config";
import { authErrorResponse, requireAdmin } from "@/lib/auth";
import { modelsEndpoint } from "@/lib/connection-drivers";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    requireAdmin(request);
    const body = await request.json().catch(() => ({}));
    const config = await readConfig();
    const saved = config.connections.find((connection) => connection.id === body.id);
    const driver = body.driver === "lmstudio" ? "lmstudio" : "openai";
    const baseUrl = String(body.baseUrl || saved?.baseUrl || "");
    const apiKey = String(body.apiKey || saved?.apiKey || (driver === "openai" ? process.env.OPENAI_API_KEY : "") || "");
    const response = await fetch(modelsEndpoint(driver, baseUrl), {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Server responded with ${response.status}`);
    const payload = await response.json();
    const rawItems = driver === "lmstudio" ? payload?.models : payload?.data;
    const items = Array.isArray(rawItems) ? rawItems.filter((item: { id?: string; key?: string; type?: string }) => (item?.id || item?.key) && (driver !== "lmstudio" || item.type === "llm")) : [];
    return NextResponse.json({ models: items.map((item: Record<string, unknown>) => inferModel(item, driver, String(body.id || saved?.id || ""))) });
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) return authErrorResponse(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "서버에 연결할 수 없습니다." },
      { status: 502 },
    );
  }
}
