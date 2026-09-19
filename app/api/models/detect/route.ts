import { NextResponse } from "next/server";
import { inferModel, readConfig } from "@/lib/config";
import { authErrorResponse, requireAdmin } from "@/lib/auth";
import { discoverModelRecords } from "@/lib/model-discovery";
import { ConnectionError } from "@/lib/connection-errors";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    requireAdmin(request);
    const body = await request.json().catch(() => ({}));
    const config = await readConfig();
    const saved = config.connections.find((connection) => connection.id === body.id);
    const driver = body.driver === "lmstudio" || body.driver === "nnui" ? body.driver : "openai";
    const baseUrl = String(body.baseUrl || saved?.baseUrl || "");
    const apiKey = (body.clearApiKey ?? saved?.clearApiKey) ? "" : String(body.apiKey || saved?.apiKey || (driver === "openai" ? process.env.OPENAI_API_KEY : "") || "");
    const items = await discoverModelRecords(driver, baseUrl, apiKey);
    return NextResponse.json({ models: items.map((item: Record<string, unknown>) => inferModel(item, driver, String(body.id || saved?.id || ""))) });
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && !(error instanceof ConnectionError)) return authErrorResponse(error);
    // The settings screen turns the code into a readable explanation; the detail keeps what the server sent.
    const failure = error instanceof ConnectionError ? error.failure : { code: "unexpected" as const, status: undefined, detail: error instanceof Error ? error.message : String(error) };
    return NextResponse.json({ error: failure.detail || "Connection failed.", code: failure.code, status: failure.status }, { status: 502 });
  }
}
