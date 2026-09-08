import { NextResponse } from "next/server";
import { renameConversation, deleteConversation, readConversation, writeConversation } from "@/lib/conversations";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { getChatJob } from "@/lib/chat-runtime";
import { settlePendingTools } from "@/lib/conversation-messages";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let user; try { user = requireUser(request); } catch (error) { return authErrorResponse(error); }
  let conversation = await readConversation(id, user.id);
  const active = () => { const job = getChatJob(id, user.id); return job && (job.status === "running" || job.status === "waiting"); };
  if (conversation && !active() && conversation.branches.some(branch => branch.messages.some(message => message.toolEvents?.some(event => event.status === "waiting" || event.status === "calling")))) {
    const recovered = { ...conversation, branches: conversation.branches.map(branch => ({ ...branch, messages: settlePendingTools(branch.messages) })) };
    await writeConversation(recovered, user.id, () => !active()).catch(() => undefined);
    conversation = await readConversation(id, user.id);
  }
  return conversation ? NextResponse.json(conversation) : NextResponse.json({ error: "대화를 찾지 못했습니다." }, { status: 404 });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const user = requireUser(request);
    const input = await request.json();
    if (input.id !== id) return NextResponse.json({ error: "대화 ID가 일치하지 않습니다." }, { status: 400 });
    return NextResponse.json(await writeConversation(input, user.id));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "대화를 저장하지 못했습니다." }, { status: 400 }); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const { id } = await context.params; const user = requireUser(request); await deleteConversation(id, user.id); return new Response(null, { status: 204 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "대화를 삭제하지 못했습니다." }, { status: 400 }); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  let user; try { user = requireUser(request); } catch (error) { return authErrorResponse(error); }
  try { const { id } = await context.params; const { title } = await request.json();
    return renameConversation(id, user.id, title) ? NextResponse.json({ title: title.trim() }) : NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  } catch { return NextResponse.json({ error: "Title must contain 1–200 characters" }, { status: 400 }); }
}
