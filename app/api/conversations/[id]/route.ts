import { NextResponse } from "next/server";
import { promoteConversation, renameConversation, deleteConversation, readConversation, writeConversation } from "@/lib/conversations";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { getChatJob } from "@/lib/chat-runtime";
import { settlePendingTools } from "@/lib/conversation-messages";
import { readConfig } from "@/lib/config";
import { DEFAULT_HARNESS_SETTINGS } from "@/lib/harness";
import { harnessCompletion } from "@/lib/harness-runtime";
import { connectionForModel } from "@/lib/connection-drivers";
import { closeBrowserSessions } from "@/lib/browser-tool";

/**
 * Titles a chat the user just promoted out of temporary mode, following the harness settings the
 * automatic path uses: the first request always, plus the first response unless titles are
 * configured to be written before the model answers.
 */
async function titleFromFirstExchange(id: string, userId: string) {
  const config = await readConfig();
  const harness = config.harnessSettings || DEFAULT_HARNESS_SETTINGS;
  if (!harness.titleEnabled) return undefined;
  const conversation = await readConversation(id, userId);
  const branch = conversation?.branches.find((item) => item.id === conversation.activeBranchId) || conversation?.branches[0];
  const request = branch?.messages.find((message) => message.role === "user");
  if (!request) return undefined;
  const response = harness.titleTiming === "before" ? "" : branch?.messages.find((message) => message.role === "assistant")?.content || "";
  const model = config.models.find((item) => item.id === (harness.titleModelId || conversation?.modelId));
  if (!model || !connectionForModel(config.connections, model)) return undefined;
  const controller = new AbortController();
  const context = { config, model, userId, signal: controller.signal, onPhase: () => undefined };
  const answer = await harnessCompletion(context, harness.titleModelId, harness.titleEffort, harness.titlePrompt,
    JSON.stringify({ user: request.content.slice(0, 2000), assistant: response.slice(0, 2000) }), 256);
  const title = answer.text.split(/\r?\n/)[0].replace(/^["'#*]+|["'*]+$/g, "").trim().slice(0, 200);
  return title || undefined;
}

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
  try {
    const { id } = await context.params; const user = requireUser(request);
    await deleteConversation(id, user.id);
    await closeBrowserSessions(`${user.id}:${id}`);
    return new Response(null, { status: 204 });
  }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "대화를 삭제하지 못했습니다." }, { status: 400 }); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  let user; try { user = requireUser(request); } catch (error) { return authErrorResponse(error); }
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  if (body.promote === true) {
    if (!promoteConversation(id, user.id)) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    // A failed title must not undo the save the user just asked for.
    const title = await titleFromFirstExchange(id, user.id).catch(() => undefined);
    if (title) renameConversation(id, user.id, title, true);
    return NextResponse.json({ promoted: true, ...(title ? { title } : {}) });
  }
  try {
    return renameConversation(id, user.id, body.title) ? NextResponse.json({ title: String(body.title).trim() }) : NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  } catch { return NextResponse.json({ error: "Title must contain 1–200 characters" }, { status: 400 }); }
}
