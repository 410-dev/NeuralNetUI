import type { ChatWaitPhase } from "./types.ts";

export type NnuiEvent = {
  id?: string;
  type: string;
  ts?: number;
  model?: string | null;
  session_id?: string | null;
  data: Record<string, unknown>;
};

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function boundedProgress(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number > 1 ? number / 100 : number)) : undefined;
}

/** Parse one SSE record from llama-nnui-server, ignoring comments and malformed payloads. */
export function nnuiEventFromSse(record: string): NnuiEvent | undefined {
  const lines = record.split(/\r?\n/);
  const eventName = lines.find(line => line.startsWith("event:"))?.slice(6).trim();
  const raw = lines.filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
  if (!raw || eventName === "connected") return undefined;
  try {
    const envelope = object(JSON.parse(raw));
    const type = typeof envelope?.type === "string" ? envelope.type : eventName;
    if (!envelope || !type) return undefined;
    return {
      ...(typeof envelope.id === "string" ? { id: envelope.id } : {}),
      type,
      ...(typeof envelope.ts === "number" ? { ts: envelope.ts } : {}),
      ...(typeof envelope.model === "string" || envelope.model === null ? { model: envelope.model as string | null } : {}),
      ...(typeof envelope.session_id === "string" || envelope.session_id === null ? { session_id: envelope.session_id as string | null } : {}),
      data: object(envelope.data) || {},
    };
  } catch { return undefined; }
}

export function nnuiEventProgress(event: NnuiEvent): { phase: ChatWaitPhase; progress: number } | undefined {
  if (event.type === "model.load.progress") {
    const progress = boundedProgress(event.data.percent);
    return progress === undefined ? undefined : { phase: "loading-model", progress };
  }
  if (event.type === "request.prefill.progress") {
    const progress = boundedProgress(event.data.percent ?? event.data.prompt_progress);
    return progress === undefined ? undefined : { phase: "processing-prompt", progress };
  }
  return undefined;
}

/** Consume the authenticated NNUI event stream until the caller aborts it. */
export async function observeNnuiEvents(url: string, headers: Record<string, string>, signal: AbortSignal, onEvent: (event: NnuiEvent) => void, request: typeof fetch = fetch, onOpen: () => void = () => {}) {
  const response = await request(url, { headers: { ...headers, Accept: "text/event-stream" }, signal, cache: "no-store" });
  if (!response.ok) throw new Error(`NNUI event stream failed (${response.status}).`);
  if (!response.body) throw new Error("NNUI event stream returned no body.");
  onOpen();
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const records = buffer.split(/\r?\n\r?\n/); buffer = records.pop() || "";
      for (const record of records) { const event = nnuiEventFromSse(record); if (event) onEvent(event); }
    }
    buffer += decoder.decode();
    const event = nnuiEventFromSse(buffer); if (event) onEvent(event);
  } finally {
    await reader.cancel().catch(() => undefined); reader.releaseLock();
  }
}

/** Start an observer without letting a missing event endpoint delay inference indefinitely. */
export function startNnuiEventObserver(url: string, headers: Record<string, string>, signal: AbortSignal, onEvent: (event: NnuiEvent) => void, request: typeof fetch = fetch) {
  let opened = false; let resolveReady!: () => void;
  const ready = new Promise<void>(resolve => { resolveReady = resolve; });
  const timer = setTimeout(resolveReady, 500); timer.unref?.();
  const markReady = () => { if (opened) return; opened = true; clearTimeout(timer); resolveReady(); };
  const done = observeNnuiEvents(url, headers, signal, onEvent, request, markReady).catch(() => undefined).finally(markReady);
  return { ready, done };
}
