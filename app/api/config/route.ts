import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { publicConfig, readConfig, writeConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(publicConfig(await readConfig()));
}

export async function PUT(request: Request) {
  try {
    const incoming = await request.json();
    const current = await readConfig();
    if (!incoming.server?.apiKey) incoming.server.apiKey = current.server.apiKey;
    const saved = await writeConfig(incoming);
    return NextResponse.json(publicConfig(saved));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof ZodError ? error.issues[0]?.message : "설정을 저장하지 못했습니다." },
      { status: 400 },
    );
  }
}
