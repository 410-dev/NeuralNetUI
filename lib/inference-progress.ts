import type { ChatMessageData, ChatMessagePartFileData } from "@lmstudio/sdk";
import type { ChatWaitPhase } from "./types.ts";

export type InferenceMessage = { role: string; content: unknown; reasoning_content?: string; tool_calls?: unknown; tool_call_id?: string; name?: string };

// SDK 1.5.0 cannot represent separate reasoning history or named effort levels. Preserve
// these requests through Chat Completions rather than silently changing model input.
export function nativeEligibility(messages: InferenceMessage[], effort?: string) {
  return (!effort || ["off", "on", "none"].includes(effort)) && !messages.some(m => Boolean(m.reasoning_content) && !(m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length));
}

/** Official lmstudio-js API-token decomposition, for the pinned SDK's legacy auth fields. */
export function sdkCredentials(authorization?: string) {
  if (!authorization) return {};
  const match = /^Bearer sk-lm-([a-zA-Z0-9]{8}):([a-zA-Z0-9]{20})$/.exec(authorization);
  return match ? { clientIdentifier: match[1], clientPasskey: match[2] } : undefined;
}

export function progressEvent(payload: Record<string, unknown>): { phase: ChatWaitPhase; progress: number } | undefined {
  const type = typeof payload.type === "string" ? payload.type : "";
  const phase = type.startsWith("model_load.") ? "loading-model" : type.startsWith("prompt_processing.") ? "processing-prompt" : undefined;
  if (!phase) return;
  const suffix = type.split(".")[1];
  const value = suffix === "start" ? 0 : suffix === "end" ? 1 : suffix === "progress" ? payload.progress : undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) return;
  return { phase, progress: value };
}

export type NativeImageSource = { kind:"data"; dataUrl:string } | { kind:"file"; path:string };

export async function nativeHistory(messages: InferenceMessage[], prepareImage: (source: NativeImageSource) => Promise<ChatMessagePartFileData>): Promise<ChatMessageData[]> {
  const result: ChatMessageData[] = [];
  for (const message of messages) {
    const currentToolRound = message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
    // The SDK cannot encode separate reasoning, but tool-request messages retain their actual
    // protocol state through content + toolCallRequest parts. Older standalone reasoning remains
    // ineligible so it is never silently dropped from ordinary conversation history.
    if (message.reasoning_content && !currentToolRound) throw new Error("Separate reasoning history requires Chat Completions.");
    if (message.role === "tool") {
      result.push({ role: "tool", content: [{ type: "toolCallResult", content: String(message.content ?? ""), toolCallId: message.tool_call_id }] });
      continue;
    }
    if (!["user", "assistant", "system"].includes(message.role)) throw new Error("Unsupported chat role.");
    const content: Array<{ type: "text"; text: string } | ChatMessagePartFileData> = [];
    if (typeof message.content === "string" && message.content) content.push({ type: "text", text: message.content });
    else if (Array.isArray(message.content)) for (const part of message.content) {
      if (part.type === "text" && typeof part.text === "string") content.push({ type: "text", text: part.text });
      else if (part.type === "image_url" && typeof part.image_url?.url === "string" && /^data:image\/(png|jpeg|webp|gif);base64,/.test(part.image_url.url)) content.push(await prepareImage({ kind:"data", dataUrl:part.image_url.url }));
      else if (part.type === "image_file" && typeof part.file_path === "string") content.push(await prepareImage({ kind:"file", path:part.file_path }));
      else throw new Error("Unsupported native message content.");
    }
    if (message.role === "assistant") {
      const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      result.push({ role: "assistant", content: [...content, ...calls.map(call => ({ type: "toolCallRequest" as const, toolCallRequest: { id: call.id, type: "function" as const, name: call.function.name, arguments: JSON.parse(call.function.arguments || "{}") } }))] });
    } else result.push({ role: message.role as "user" | "system", content });
  }
  return result;
}
