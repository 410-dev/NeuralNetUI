import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { publicConfig, readConfig, writeConfigForUser } from "@/lib/config";
import { authErrorResponse, requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try { const user = requireUser(request); return NextResponse.json(publicConfig(await readConfig(), user)); }
  catch (error) { return authErrorResponse(error); }
}

export async function PUT(request: Request) {
  try {
    const incoming = await request.json();
    const user = requireUser(request);
    const saved = await writeConfigForUser(incoming, user);
    const admin = user.role === "admin" || user.role === "superadmin";
    return NextResponse.json(publicConfig(saved, { ...user, displayName: admin ? incoming.profile?.name || user.displayName : user.displayName, preferences: { ...user.preferences, sendReasoningToModel: incoming.preferences?.sendReasoningToModel, exportReasoning: incoming.preferences?.exportReasoning, language: incoming.preferences?.language } }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof ZodError ? error.issues[0]?.message : "설정을 저장하지 못했습니다." },
      { status: error && typeof error === "object" && "status" in error ? Number(error.status) : 400 },
    );
  }
}
