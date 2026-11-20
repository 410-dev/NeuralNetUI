import { NextResponse } from "next/server";
import { inferModel, readConfig } from "@/lib/config";
import { authErrorResponse, requireAdmin } from "@/lib/auth";
import { discoverModelRecords, discoverPropsSamplingDefaults } from "@/lib/model-discovery";
import { lmStudioSamplingDefaults } from "@/lib/lm-studio-progress";
import { ConnectionError } from "@/lib/connection-errors";
import { envApiKey, isCloudDriver } from "@/lib/connection-drivers";
import type { ConnectionDriver } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    requireAdmin(request);
    const body = await request.json().catch(() => ({}));
    const config = await readConfig();
    const saved = config.connections.find((connection) => connection.id === body.id);
    const driver: ConnectionDriver = ["lmstudio", "google", "anthropic"].includes(body.driver) ? body.driver : "openai";
    const baseUrl = String(body.baseUrl || saved?.baseUrl || "");
    const apiKey = (body.clearApiKey ?? saved?.clearApiKey) ? "" : String(body.apiKey || saved?.apiKey || envApiKey(driver) || "");
    const items = await discoverModelRecords(driver, baseUrl, apiKey);
    // Server defaults for the inference parameters; a model whose defaults cannot be read gets none.
    const ids = items.map(item => String(item.key || item.id || "")).filter(Boolean);
    const defaults = isCloudDriver(driver) ? new Map() : driver === "lmstudio" ? await lmStudioSamplingDefaults(baseUrl, apiKey ? `Bearer ${apiKey}` : undefined) : await discoverPropsSamplingDefaults(baseUrl, apiKey, ids);
    for (const item of items) { const found = defaults.get(String(item.key || item.id || "")); if (found) item._samplingDefaults = found; }
    return NextResponse.json({ models: items.map((item: Record<string, unknown>) => inferModel(item, driver, String(body.id || saved?.id || ""))) });
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && !(error instanceof ConnectionError)) return authErrorResponse(error);
    // The settings screen turns the code into a readable explanation; the detail keeps what the server sent.
    const failure = error instanceof ConnectionError ? error.failure : { code: "unexpected" as const, status: undefined, detail: error instanceof Error ? error.message : String(error) };
    return NextResponse.json({ error: failure.detail || "Connection failed.", code: failure.code, status: failure.status }, { status: 502 });
  }
}
