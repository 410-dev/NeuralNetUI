import { readConfig } from "@/lib/config";
import { readUploadDataUrl } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InputMessage = { role: "user" | "assistant" | "system"; content: string; reasoning_content?: string; attachments?: Array<{ id: string }> };
type UpstreamMessage = { role: InputMessage["role"]; content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>; reasoning_content?: string };

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      modelId?: string;
      reasoningPresetId?: string;
      sendReasoning?: boolean;
      messages?: InputMessage[];
    };
    const config = await readConfig();
    const model = config.models.find((item) => item.id === body.modelId) || config.models[0];
    if (!model) return Response.json({ error: "설정된 모델이 없습니다." }, { status: 400 });

    const preset = model.reasoningPresets.find((item) => item.id === body.reasoningPresetId);
    const modelPrompt = model.systemPrompt?.trim() || "";
    const presetPrompt = preset?.kind === "custom" ? preset.systemPrompt?.trim() || "" : "";
    let systemPrompt = modelPrompt;
    if (presetPrompt) {
      if (preset?.systemPromptMode === "replace") systemPrompt = presetPrompt;
      else if (preset?.systemPromptMode === "prepend") systemPrompt = [presetPrompt, modelPrompt].filter(Boolean).join("\n\n");
      else systemPrompt = [modelPrompt, presetPrompt].filter(Boolean).join("\n\n");
    }
    const conversationMessages: UpstreamMessage[] = await Promise.all((Array.isArray(body.messages) ? body.messages : []).filter((message) => message?.content || message?.attachments?.length).map(async (message) => {
      const attachments = message.role === "user" && Array.isArray(message.attachments) ? message.attachments : [];
      const content: UpstreamMessage["content"] = attachments.length
        ? [
            ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
            ...(await Promise.all(attachments.map(async (attachment) => ({ type: "image_url" as const, image_url: { url: await readUploadDataUrl(attachment.id) } })))),
          ]
        : message.content;
      return {
        role: message.role,
        content,
        ...(body.sendReasoning && message.role === "assistant" && message.reasoning_content ? { reasoning_content: message.reasoning_content } : {}),
      };
    }));
    const messages: UpstreamMessage[] = [
      ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
      ...conversationMessages,
    ];
    if (!messages.some((message) => message.role === "user")) {
      return Response.json({ error: "메시지가 비어 있습니다." }, { status: 400 });
    }

    const upstreamBody: Record<string, unknown> = {
      model: model.sourceModel,
      messages,
      stream: true,
    };
    if (preset?.effort) upstreamBody.reasoning_effort = preset.effort;

    const apiKey = config.server.apiKey || process.env.OPENAI_API_KEY || "";
    const upstream = await fetch(`${config.server.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(upstreamBody),
      signal: request.signal,
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      return Response.json({ error: detail || `Model server responded with ${upstream.status}` }, { status: upstream.status });
    }

    return new Response(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "요청 처리에 실패했습니다." }, { status: 500 });
  }
}
