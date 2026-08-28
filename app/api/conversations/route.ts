import { NextResponse } from "next/server";
import { listConversations, writeConversation } from "@/lib/conversations";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ conversations: await listConversations() });
}

export async function POST(request: Request) {
  try { return NextResponse.json(await writeConversation(await request.json()), { status: 201 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "대화를 저장하지 못했습니다." }, { status: 400 }); }
}
