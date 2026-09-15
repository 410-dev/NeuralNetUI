import { NextResponse } from "next/server";
import { searchConversations, deleteAllConversations, deleteConversations, deleteConversationsMatching, discardTemporaryConversations, listConversations, listConversationsPage, purgeExpiredConversations, writeConversation } from "@/lib/conversations";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { readConfig } from "@/lib/config";
import { closeBrowserSessions } from "@/lib/browser-tool";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = requireUser(request);
    const config=await readConfig();await purgeExpiredConversations(user.id,config.userStorageSettings.trashRetentionDays);
    const params = new URL(request.url).searchParams;
    if(params.get("manage")==="1")return NextResponse.json(await listConversationsPage(user.id,{page:Number(params.get("page")||1),pageSize:Number(params.get("pageSize")||20),query:String(params.get("q")||""),state:"active",inactiveHours:Number(params.get("inactiveHours")||0)}));
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
  try {
    const user=requireUser(request);const body=await request.json().catch(()=>undefined) as {ids?:unknown[];filter?:{query?:unknown;inactiveHours?:unknown}}|undefined;
    let ids:string[]=[];let deleted=0;
    if(Array.isArray(body?.ids)){ids=await deleteConversations([...new Set(body.ids.map(String))],user.id);deleted=ids.length;}
    else if(body?.filter){ids=await deleteConversationsMatching(user.id,{query:String(body.filter.query||""),inactiveHours:Number(body.filter.inactiveHours||0)});deleted=ids.length;}
    else {ids=(await listConversations(user.id)).map(item=>item.id);deleted=await deleteAllConversations(user.id);}
    await Promise.all(ids.map(id=>closeBrowserSessions(`${user.id}:${id}`)));
    return NextResponse.json({deleted});
  }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "대화를 삭제하지 못했습니다." }, { status: 500 }); }
}
