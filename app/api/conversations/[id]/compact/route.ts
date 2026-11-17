import { authErrorResponse, AuthError, requireUser } from "@/lib/auth";
import { compactConversation } from "@/lib/context-compact";
import { branchOwnedBy } from "@/lib/context-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /compact and /compact summarize from the composer. The reply is a stream of server-sent events: "update" events
 * carry the summary and the compaction model's thinking as they are written, then one "done" or "error" event.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let input: Parameters<typeof compactConversation>[0];
  try {
    const user = requireUser(request); const { id } = await context.params;
    const body = await request.json().catch(() => ({})) as { branchId?: unknown; mode?: unknown; modelId?: unknown; aliasBaseModelId?: unknown };
    const branchId = typeof body.branchId === "string" ? body.branchId : "";
    if (!branchOwnedBy(branchId, id, user.id)) throw new AuthError("대화를 찾을 수 없습니다.", 404);
    input = {
      userId: user.id, conversationId: id, branchId, mode: body.mode === "summarize" ? "summarize" : "default",
      modelId: typeof body.modelId === "string" ? body.modelId : undefined,
      aliasBaseModelId: typeof body.aliasBaseModelId === "string" ? body.aliasBaseModelId : undefined,
      signal: request.signal,
    };
  } catch (error) { return authErrorResponse(error); }
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => { try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { /* the client left */ } };
      let lastUpdate = 0; let pending: { summary: string; reasoning: string } | undefined; let timer: ReturnType<typeof setTimeout> | undefined;
      const flush = () => { timer = undefined; if (pending) { send("update", pending); pending = undefined; lastUpdate = Date.now(); } };
      try {
        const result = await compactConversation({ ...input, onUpdate: update => {
          pending = update;
          if (Date.now() - lastUpdate >= 120) flush(); else timer ??= setTimeout(flush, 120);
        } });
        if (timer) clearTimeout(timer); flush();
        send("done", result);
      } catch (error) {
        if (timer) clearTimeout(timer);
        send("error", { error: error instanceof Error ? error.message : String(error) });
      } finally { try { controller.close(); } catch { /* already closed */ } }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
