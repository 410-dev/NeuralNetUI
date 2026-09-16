import { createReadStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { searchConversations, deleteAllConversations, deleteConversations, deleteConversationsMatching, discardTemporaryConversations, listConversations, listConversationsPage, purgeExpiredConversations, readConversation, writeConversation } from "@/lib/conversations";
import { createZipArchive, type ZipEntry } from "@/lib/zip-archive";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { readConfig } from "@/lib/config";
import { closeBrowserSessions } from "@/lib/browser-tool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Packages the signed-in person's own chats, every branch included, as one archive. Each chat keeps
 * its own file so the export stays separable, and reasoning is dropped on request exactly as the
 * single-chat export drops it.
 */
async function conversationArchive(userId: string, includeReasoning: boolean) {
  const summaries = await listConversations(userId);
  const entries: ZipEntry[] = [];
  const index: Array<{ id: string; title: string; file: string; updatedAt: string }> = [];
  for (const summary of summaries) {
    const conversation = await readConversation(summary.id, userId);
    if (!conversation) continue;
    const exported = includeReasoning ? conversation : { ...conversation, branches: conversation.branches.map((branch) => ({ ...branch, messages: branch.messages.map(({ reasoning: _reasoning, ...message }) => message) })) };
    const file = `chats/${conversation.title.replace(/[^a-z0-9가-힣_-]+/gi, "-").slice(0, 80) || "chat"}-${conversation.id}.json`;
    entries.push({ name: file, data: Buffer.from(JSON.stringify(exported, null, 2), "utf8") });
    index.push({ id: conversation.id, title: conversation.title, file, updatedAt: conversation.updatedAt });
  }
  if (!entries.length) return null;
  entries.unshift({ name: "chats.json", data: Buffer.from(JSON.stringify({ exportedAt: new Date().toISOString(), includeReasoning, chats: index }, null, 2), "utf8") });
  return createZipArchive(entries);
}

export async function GET(request: Request) {
  try {
    const user = requireUser(request);
    const config=await readConfig();await purgeExpiredConversations(user.id,config.userStorageSettings.trashRetentionDays);
    const params = new URL(request.url).searchParams;
    if (params.get("download") === "archive") {
      const archive = await conversationArchive(user.id, params.get("reasoning") !== "0");
      if (!archive) return NextResponse.json({ error: "내보낼 채팅이 없습니다." }, { status: 404 });
      const stream = createReadStream(archive.path);
      stream.once("close", () => void fs.rm(archive.directory, { recursive: true, force: true }));
      return new Response(Readable.toWeb(stream) as ReadableStream, { headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(archive.size),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`neuralnetui-chats-${new Date().toISOString().slice(0, 10)}.zip`)}`,
        "Cache-Control": "no-store",
      } });
    }
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
