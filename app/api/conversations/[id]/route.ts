import { NextResponse } from "next/server";
import { deleteConversation, readConversation, writeConversation } from "@/lib/conversations";
import { authErrorResponse, requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let user; try { user = requireUser(request); } catch (error) { return authErrorResponse(error); }
  const conversation = await readConversation(id, user.id);
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
