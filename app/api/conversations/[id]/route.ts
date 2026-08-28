import { NextResponse } from "next/server";
import { deleteConversation, readConversation, writeConversation } from "@/lib/conversations";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const conversation = await readConversation(id);
  return conversation ? NextResponse.json(conversation) : NextResponse.json({ error: "대화를 찾지 못했습니다." }, { status: 404 });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const input = await request.json();
    if (input.id !== id) return NextResponse.json({ error: "대화 ID가 일치하지 않습니다." }, { status: 400 });
    return NextResponse.json(await writeConversation(input));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "대화를 저장하지 못했습니다." }, { status: 400 }); }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  try { const { id } = await context.params; await deleteConversation(id); return new Response(null, { status: 204 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "대화를 삭제하지 못했습니다." }, { status: 400 }); }
}
