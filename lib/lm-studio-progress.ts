import { LMStudioClient, type LLMTool } from "@lmstudio/sdk";
import { connectionRoot } from "./connection-drivers.ts";
import { abortable } from "./chat-progress.ts";
import { nativeEligibility, nativeHistory, sdkCredentials, type InferenceMessage } from "./inference-progress.ts";

function sdkClient(baseUrl: string, authorization?: string) {
  const credentials = sdkCredentials(authorization);
  if (!credentials) return;
  const url = new URL(connectionRoot(baseUrl));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return new LMStudioClient({ baseUrl: url.toString().replace(/\/$/, ""), ...credentials, logger: { debug() {}, info() {}, warn() {}, error() {} } });
}

/** A request-scoped SDK client prevents progress crossing users or model servers. */
export async function loadWithProgress(baseUrl: string, model: string, contextLength: number | undefined, signal: AbortSignal, onProgress: (progress: number) => void, authorization?: string) {
  const client = sdkClient(baseUrl, authorization);
  if (!client) return false;
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(300_000)]);
  const dispose = () => { void client[Symbol.asyncDispose]().catch(() => undefined); };
  bounded.addEventListener("abort", dispose, { once: true });
  try {
    bounded.throwIfAborted();
    // Probe without changing residency. Older servers/proxies may expose REST but no SDK.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([client.llm.listLoaded(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("SDK unavailable")), 2000);
      })]);
    } catch {
      bounded.throwIfAborted();
      return false;
    } finally { if (timer) clearTimeout(timer); }
    await client.llm.model(model, { config: contextLength ? { contextLength } : {}, signal: bounded, verbose: false, onProgress });
    bounded.throwIfAborted();
    return true;
  } finally {
    bounded.removeEventListener("abort", dispose);
    await client[Symbol.asyncDispose]();
  }
}

/** Adapts native per-request SDK events to the existing tool loop's stream contract.
 * Fallback is allowed only BEFORE inference starts; a failed prediction is never replayed.
 */
export async function nativeChatResponse(options: {
  baseUrl: string; authorization?: string; model: string; messages: InferenceMessage[];
  effort?: string; maxTokens?: number; tools?: LLMTool[]; signal: AbortSignal;
}): Promise<Response | undefined> {
  if (!nativeEligibility(options.messages, options.effort)) return;
  const client = sdkClient(options.baseUrl, options.authorization);
  if (!client) return;
  const cancellation = new AbortController();
  const signal = AbortSignal.any([options.signal, cancellation.signal]);
  const dispose = () => { void client[Symbol.asyncDispose]().catch(() => undefined); };
  signal.addEventListener("abort", dispose, { once: true });
  let transferred = false;
  try {
    signal.throwIfAborted();
    let models;
    try { models = await abortable(client.llm.listLoaded(), AbortSignal.any([signal, AbortSignal.timeout(2000)])); }
    catch { signal.throwIfAborted(); return; }
    // Never load outside the server-wide residency lock, including after manual unload.
    const model = models.find(m => m.identifier === options.model || m.modelKey === options.model || m.path === options.model);
    if (!model) return;
    const history = await abortable(nativeHistory(options.messages, async dataUrl => {
      const [, mime, data] = /^data:(image\/(?:png|jpeg|webp|gif));base64,([\s\S]*)$/.exec(dataUrl)!;
      const file = await client.files.prepareImageBase64(`image.${mime.split("/")[1]}`, data);
      return { type: "file", name: file.name, identifier: file.identifier, sizeBytes: file.sizeBytes, fileType: file.type };
    }), AbortSignal.any([signal, AbortSignal.timeout(30_000)]));
    signal.throwIfAborted();
    const encoder = new TextEncoder();
    let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (payload: unknown) => { if (!closed && !signal.aborted) controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)); };
        let reasoningTokens = 0; let toolError: Error | undefined;
        try {
          const result = await model.respond({ messages: history }, {
            signal, ...(options.maxTokens ? { maxTokens: options.maxTokens } : {}),
            contextOverflowPolicy: "stopAtLimit", toolNaming: "passThrough",
            ...(options.effort ? { raw: { fields: [{ key: "llm.prediction.reasoning.enableThinking", value: options.effort === "on" }] } } : {}),
            ...(options.tools?.length ? { rawTools: { type: "toolArray", tools: options.tools } } : {}),
            onPromptProcessingProgress: progress => emit({ type: "prompt_processing.progress", progress }),
            onPredictionFragment: fragment => {
              if (fragment.reasoningType === "reasoning") reasoningTokens += Math.max(0, fragment.tokensCount || 0);
              if (fragment.isStructural || !["none", "reasoning"].includes(fragment.reasoningType)) return;
              emit({ choices: [{ delta: { [fragment.reasoningType === "reasoning" ? "reasoning_content" : "content"]: fragment.content } }] });
            },
            onToolCallRequestEnd: (index, { toolCallRequest: call }) => emit({ choices: [{ delta: { tool_calls: [{ index, id: call.id || `tool-${crypto.randomUUID()}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments || {}) } }] } }] }),
            onToolCallRequestFailure: (_index, error) => { toolError = new Error(`The model generated an invalid tool call: ${error.message}`); },
          });
          signal.throwIfAborted();
          if (toolError) throw toolError;
          if (["failed", "modelUnloaded", "userStopped"].includes(result.stats.stopReason)) throw new Error(`Model prediction ended: ${result.stats.stopReason}`);
          emit({ choices: [{ delta: {}, finish_reason: "stop" }], usage: {
            prompt_tokens: result.stats.promptTokensCount, completion_tokens: result.stats.predictedTokensCount, total_tokens: result.stats.totalTokensCount,
            completion_tokens_details: { reasoning_tokens: Math.min(reasoningTokens, result.stats.predictedTokensCount ?? reasoningTokens) },
          } });
          if (!closed) { controller.enqueue(encoder.encode("data: [DONE]\n\n")); controller.close(); closed = true; }
        } catch (error) { if (!closed) { controller.error(error); closed = true; } }
        finally { signal.removeEventListener("abort", dispose); await client[Symbol.asyncDispose]().catch(() => undefined); }
      },
      cancel() { closed = true; cancellation.abort(); },
    });
    transferred = true;
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "X-NeuralNetUI-Progress": "native" } });
  } finally {
    if (!transferred) { signal.removeEventListener("abort", dispose); await client[Symbol.asyncDispose]().catch(() => undefined); }
  }
}
