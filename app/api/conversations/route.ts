import { NextResponse } from "next/server";
import { searchConversations, deleteAllConversations, listConversations, writeConversation } from "@/lib/conversations";
import { authErrorResponse, requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try { const user = requireUser(request); const query = new URL(request.url).searchParams.get("q"); return NextResponse.json(query !== null ? { results: await searchConversations(user.id, query) } : { conversations: await listConversations(user.id) }); }
  catch (error) { return authErrorResponse(error); }
}

export async function POST(request: Request) {
  try { const user = requireUser(request); return NextResponse.json(await writeConversation(await request.json(), user.id), { status: 201 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "대화를 저장하지 못했습니다." }, { status: 400 }); }
}

export async function DELETE(request: Request) {
  try { const user = requireUser(request); return NextResponse.json({ deleted: await deleteAllConversations(user.id) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "대화를 삭제하지 못했습니다." }, { status: 500 }); }
}
