import { authErrorResponse, requireUser } from "@/lib/auth";
import { sendAgentMessage } from "@/lib/agent/runtime";
import { readUpload } from "@/lib/uploads";
import type { StoredAttachment } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A message from the person to the agent. The agent answers right away, or right after the reply it is writing. */
export async function POST(request: Request) {
  try {
    const user = requireUser(request);
    const body = await request.json().catch(() => ({})) as { content?: unknown; attachments?: Array<{ id?: unknown }>; modelId?: unknown; aliasBaseModelId?: unknown; reasoningPresetId?: unknown; clientContext?: { timeZone?: unknown; locale?: unknown; language?: unknown } };
    const content = typeof body.content === "string" ? body.content.slice(0, 200_000) : "";
    const attachments: StoredAttachment[] = [];
    for (const item of (Array.isArray(body.attachments) ? body.attachments : []).slice(0, 50)) {
      const stored = await readUpload(String(item?.id || ""), user.id);
      attachments.push(stored.metadata as StoredAttachment);
    }
    if (!content.trim() && !attachments.length) return Response.json({ error: "The message is empty." }, { status: 400 });
    const text = (value: unknown) => typeof value === "string" && value ? value : undefined;
    const result = await sendAgentMessage(user.id, { content, attachments, settings: {
      modelId: text(body.modelId), aliasBaseModelId: text(body.aliasBaseModelId), reasoningPresetId: text(body.reasoningPresetId),
      timeZone: text(body.clientContext?.timeZone), locale: text(body.clientContext?.locale), language: body.clientContext?.language === "en" ? "en" : body.clientContext?.language === "ko" ? "ko" : undefined,
    } });
    return Response.json(result, { status: 202 });
  } catch (error) { return authErrorResponse(error); }
}
