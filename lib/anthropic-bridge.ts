import Anthropic from "@anthropic-ai/sdk";
import { legacyAnthropicModel } from "./reasoning-capabilities.ts";

/**
 * Anthropic connections speak the native Messages API through the official SDK. The rest of the app builds
 * OpenAI-style Chat Completions requests and reads Chat Completions streams, so this module translates the
 * request on the way out and the response (streamed or not) on the way back, behind a fetch-shaped function.
 */

type Json = Record<string, unknown>;
type Block = Anthropic.ContentBlockParam;
type ToolResultContent = Anthropic.ToolResultBlockParam["content"];

const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);


export function anthropicEffort(value: unknown): Anthropic.OutputConfig["effort"] | undefined {
  if (typeof value !== "string") return undefined;
  const effort = value.toLowerCase();
  if (EFFORTS.has(effort)) return effort as Anthropic.OutputConfig["effort"];
  if (effort === "none" || effort === "minimal") return "low";
  return undefined;
}

function imageBlock(url: string): Anthropic.ImageBlockParam | undefined {
  const data = /^data:(image\/(?:png|jpeg|gif|webp));base64,([\s\S]+)$/i.exec(url);
  if (data) return { type: "image", source: { type: "base64", media_type: data[1].toLowerCase() as "image/png", data: data[2] } };
  if (/^https?:\/\//i.test(url)) return { type: "image", source: { type: "url", url } };
  return undefined;
}

function contentBlocks(content: unknown): Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> {
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  if (!Array.isArray(content)) return [];
  const blocks: Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> = [];
  for (const raw of content) {
    if (!raw || typeof raw !== "object") continue;
    const part = raw as Json;
    if (part.type === "text" && typeof part.text === "string" && part.text) blocks.push({ type: "text", text: part.text });
    else if (part.type === "image_url") {
      const url = typeof part.image_url === "string" ? part.image_url : String((part.image_url as Json | undefined)?.url || "");
      const image = imageBlock(url);
      if (image) blocks.push(image);
    }
  }
  return blocks;
}

function textOf(content: unknown) {
  return contentBlocks(content).flatMap(block => block.type === "text" ? [block.text] : []).join("\n");
}

function toolInput(args: unknown): Json {
  if (args && typeof args === "object" && !Array.isArray(args)) return args as Json;
  try { const parsed = JSON.parse(String(args || "{}")); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { value: parsed }; }
  catch { return { _raw: String(args ?? "") }; }
}

/** Chat Completions messages become a system prompt and alternating Messages API turns. */
export function toAnthropicMessages(messages: unknown[]): { system?: string; messages: Anthropic.MessageParam[] } {
  const system: string[] = [];
  const turns: Anthropic.MessageParam[] = [];
  const push = (role: "user" | "assistant", blocks: Block[]) => {
    if (!blocks.length) return;
    const last = turns[turns.length - 1];
    // Tool results must open the user turn that follows the tool calls, so they never merge after plain text.
    if (last && last.role === role && !(role === "user" && blocks[0].type === "tool_result" && (last.content as Block[]).some(block => block.type !== "tool_result"))) (last.content as Block[]).push(...blocks);
    else turns.push({ role, content: [...blocks] });
  };
  for (const raw of messages) {
    if (!raw || typeof raw !== "object") continue;
    const message = raw as Json;
    if (message.role === "system" || message.role === "developer") { const text = textOf(message.content); if (text) system.push(text); continue; }
    if (message.role === "tool") {
      const blocks = contentBlocks(message.content);
      push("user", [{ type: "tool_result", tool_use_id: String(message.tool_call_id || ""), content: (blocks.length ? blocks : [{ type: "text", text: "(empty)" }]) as ToolResultContent }]);
      continue;
    }
    if (message.role === "assistant") {
      const blocks: Block[] = contentBlocks(message.content).filter(block => block.type === "text");
      for (const call of Array.isArray(message.tool_calls) ? message.tool_calls as Json[] : []) {
        const fn = (call.function || {}) as Json;
        blocks.push({ type: "tool_use", id: String(call.id || `toolu_${crypto.randomUUID().replace(/-/g, "")}`), name: String(fn.name || "tool"), input: toolInput(fn.arguments) });
      }
      push("assistant", blocks);
      continue;
    }
    push("user", contentBlocks(message.content));
  }
  // The conversation must open with a user turn.
  if (!turns.length || turns[0].role !== "user") turns.unshift({ role: "user", content: [{ type: "text", text: "(continue)" }] });
  return { ...(system.length ? { system: system.join("\n\n") } : {}), messages: turns };
}

function toAnthropicTools(tools: unknown): Anthropic.Tool[] | undefined {
  if (!Array.isArray(tools) || !tools.length) return undefined;
  return tools.flatMap(raw => {
    const fn = (raw as Json | undefined)?.function as Json | undefined;
    if (!fn?.name) return [];
    const schema = fn.parameters && typeof fn.parameters === "object" ? fn.parameters as Json : { type: "object", properties: {} };
    return [{ name: String(fn.name), ...(fn.description ? { description: String(fn.description) } : {}), input_schema: { ...schema, type: "object" } as Anthropic.Tool.InputSchema }];
  });
}

/**
 * The Messages API request for a Chat Completions body. Sampling parameters are not forwarded: current Claude
 * models reject temperature, top_p and top_k, and depth is steered with effort instead.
 */
export function toAnthropicRequest(body: Json): Anthropic.MessageCreateParamsStreaming {
  const model = String(body.model || "");
  const { system, messages } = toAnthropicMessages(Array.isArray(body.messages) ? body.messages : []);
  const tools = toAnthropicTools(body.tools);
  const legacy = legacyAnthropicModel(model);
  const effort = legacy ? undefined : anthropicEffort(body.reasoning_effort);
  const requested = Number(body.max_tokens ?? body.max_completion_tokens);
  return {
    model, messages, stream: true,
    max_tokens: Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : legacy ? 8_192 : 32_000,
    ...(system ? { system } : {}),
    ...(tools?.length ? { tools, tool_choice: { type: "auto" } } : {}),
    // Readable reasoning: newer models think adaptively and return empty thinking text unless asked to summarize.
    ...(legacy ? {} : { thinking: { type: "adaptive", display: "summarized" } }),
    ...(effort ? { output_config: { effort } } : {}),
  } as Anthropic.MessageCreateParamsStreaming;
}

const FINISH: Record<string, string> = { end_turn: "stop", stop_sequence: "stop", tool_use: "tool_calls", max_tokens: "length", refusal: "content_filter", pause_turn: "stop", model_context_window_exceeded: "length" };

type Chunk = Json;
/** Turns Messages API stream events into Chat Completions chunks (without the `data:` framing). */
export function createChunkTranslator(model: string) {
  const id = `chatcmpl-${crypto.randomUUID()}`;
  const toolIndexes = new Map<number, number>();
  let inputTokens = 0; let cacheTokens = 0;
  const chunk = (delta: Json, finish: string | null = null): Chunk => ({ id, object: "chat.completion.chunk", model, choices: [{ index: 0, delta, finish_reason: finish }] });
  return (event: Anthropic.RawMessageStreamEvent): Chunk[] => {
    switch (event.type) {
      case "message_start": {
        const usage = event.message.usage;
        inputTokens = usage.input_tokens || 0; cacheTokens = (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
        return [chunk({ role: "assistant", content: "" })];
      }
      case "content_block_start": {
        if (event.content_block.type !== "tool_use") return [];
        const index = toolIndexes.size; toolIndexes.set(event.index, index);
        return [chunk({ tool_calls: [{ index, id: event.content_block.id, type: "function", function: { name: event.content_block.name, arguments: "" } }] })];
      }
      case "content_block_delta": {
        const delta = event.delta;
        if (delta.type === "text_delta") return delta.text ? [chunk({ content: delta.text })] : [];
        if (delta.type === "thinking_delta") return delta.thinking ? [chunk({ reasoning_content: delta.thinking })] : [];
        if (delta.type === "input_json_delta") {
          const index = toolIndexes.get(event.index);
          return index === undefined || !delta.partial_json ? [] : [chunk({ tool_calls: [{ index, function: { arguments: delta.partial_json } }] })];
        }
        return [];
      }
      case "message_delta": {
        // Final usage counts here are cumulative; a missing field keeps the message_start value.
        const usage = event.usage;
        const output = usage.output_tokens || 0;
        const cached = usage.cache_read_input_tokens != null || usage.cache_creation_input_tokens != null ? (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0) : cacheTokens;
        const prompt = (usage.input_tokens ?? inputTokens) + cached;
        return [
          chunk({}, FINISH[String(event.delta.stop_reason || "end_turn")] || "stop"),
          { id, object: "chat.completion.chunk", model, choices: [], usage: { prompt_tokens: prompt, completion_tokens: output, total_tokens: prompt + output } },
        ];
      }
      default: return [];
    }
  };
}

function errorResponse(error: unknown) {
  if (error instanceof Anthropic.APIError && typeof error.status === "number") {
    const detail = error.error && typeof error.error === "object" ? JSON.stringify(error.error) : error.message;
    return new Response(detail || `Anthropic API responded with ${error.status}`, { status: error.status, headers: { "Content-Type": "application/json" } });
  }
  throw error;
}

function clientFor(baseUrl: string, apiKey: string) {
  const url = new URL(baseUrl);
  url.pathname = url.pathname.replace(/\/v1\/?$/, "") || "/";
  return new Anthropic({ apiKey, baseURL: url.toString().replace(/\/$/, ""), maxRetries: 2 });
}

/** The API key the request was made with, whether it came as x-api-key or a bearer token. */
function keyFrom(headers: HeadersInit | undefined) {
  const read = new Headers(headers);
  return read.get("x-api-key") || (read.get("authorization") || "").replace(/^Bearer\s+/i, "");
}

/**
 * A fetch for Chat Completions requests aimed at an Anthropic connection. The URL's root is the API base; the
 * answer is a Chat Completions response, streamed as SSE when the body asked for a stream.
 */
export const anthropicChatFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const body = JSON.parse(String(init?.body || "{}")) as Json;
  const client = clientFor(url.replace(/\/chat\/completions\/?$/, ""), keyFrom(init?.headers));
  const request = toAnthropicRequest(body);
  const signal = init?.signal ?? undefined;
  let stream: AsyncIterable<Anthropic.RawMessageStreamEvent>;
  try { stream = await client.messages.create(request, { signal }); }
  catch (error) { return errorResponse(error); }
  const translate = createChunkTranslator(request.model);
  if (body.stream !== true) {
    let content = ""; let reasoning = ""; let finish = "stop"; let usage: Json = {};
    const calls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> = [];
    try {
      for await (const event of stream) for (const piece of translate(event)) {
        if (piece.usage) usage = piece.usage as Json;
        const choice = (piece.choices as Json[])[0]; if (!choice) continue;
        const delta = choice.delta as Json;
        if (typeof delta.content === "string") content += delta.content;
        if (typeof delta.reasoning_content === "string") reasoning += delta.reasoning_content;
        for (const part of (delta.tool_calls as Json[] | undefined) || []) {
          const index = Number(part.index); const fn = (part.function || {}) as Json;
          calls[index] ??= { id: String(part.id || ""), type: "function", function: { name: "", arguments: "" } };
          if (fn.name) calls[index].function.name += String(fn.name);
          if (fn.arguments) calls[index].function.arguments += String(fn.arguments);
        }
        if (choice.finish_reason) finish = String(choice.finish_reason);
      }
    } catch (error) { return errorResponse(error); }
    return Response.json({ object: "chat.completion", model: request.model, choices: [{ index: 0, finish_reason: finish, message: { role: "assistant", content, ...(reasoning ? { reasoning_content: reasoning } : {}), ...(calls.length ? { tool_calls: calls.filter(Boolean) } : {}) } }], usage });
  }
  const encoder = new TextEncoder();
  const iterator = stream[Symbol.asyncIterator]();
  const sse = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        // A pull that enqueues nothing is not called again, so read until an event yields a chunk.
        for (;;) {
          const { done, value } = await iterator.next();
          if (done) { controller.enqueue(encoder.encode("data: [DONE]\n\n")); controller.close(); return; }
          const pieces = translate(value);
          for (const piece of pieces) controller.enqueue(encoder.encode(`data: ${JSON.stringify(piece)}\n\n`));
          if (pieces.length) return;
        }
      } catch (error) {
        const message = error instanceof Anthropic.APIError ? `${error.status ?? ""} ${JSON.stringify(error.error ?? error.message)}`.trim() : error instanceof Error ? error.message : String(error);
        controller.error(new Error(`Anthropic stream failed: ${message}`));
      }
    },
    async cancel() { await iterator.return?.(); },
  });
  return new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream" } });
};
