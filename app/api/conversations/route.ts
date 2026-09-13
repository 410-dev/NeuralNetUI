import { NextResponse } from "next/server";
import { searchConversations, deleteAllConversations, discardTemporaryConversations, listConversations, purgeExpiredConversations, writeConversation } from "@/lib/conversations";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { readConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = requireUser(request);
    const config=await readConfig();await purgeExpiredConversations(user.id,config.userStorageSettings.trashRetentionDays);
    const params = new URL(request.url).searchParams;
    const query = params.get("q");
    if (query !== null) return NextResponse.json({ results: await searchConversations(user.id, query) });
    // The client names the temporary chat it still has open; every other one is abandoned.
    const keep = params.get("keepTemporary");
    await discardTemporaryConversations(user.id, keep && /^[a-zA-Z0-9_-]+$/.test(keep) ? keep : undefined);
    return NextResponse.json({ conversations: await listConversations(user.id) });
  }
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
