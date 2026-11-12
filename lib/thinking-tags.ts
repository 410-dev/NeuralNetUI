/**
 * Thinking tags written into a model's text. Servers split reasoning out of the text only for formats their
 * parser knows, and get it wrong in both directions: a reply arrives with `<think>…</think>` still inside the
 * content, or the whole reply, answer included, arrives as reasoning. Each served model has a list of start/end
 * pairs; both streams are run through them so that text between a start and an end tag is reasoning and the rest
 * is the answer, wherever the server put it. Tags need no surrounding whitespace. Imports nothing from Node.
 */

export type ThinkingTag = { start: string; end: string };
export type ThinkingPiece = { kind: "reasoning" | "content"; text: string };

export const DEFAULT_THINKING_TAGS: ThinkingTag[] = [
  { start: "<think>", end: "</think>" },
  { start: "<thinking>", end: "</thinking>" },
  { start: "<|channel>thought", end: "<channel|>" },
];
export const MAX_THINKING_TAGS = 12;
export const MAX_THINKING_TAG_LENGTH = 64;

/** Keeps complete, distinct pairs; `undefined` (never configured) means the defaults, an empty list means none. */
export function normalizeThinkingTags(value: unknown): ThinkingTag[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const tags: ThinkingTag[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const start = typeof (item as ThinkingTag).start === "string" ? (item as ThinkingTag).start.trim().slice(0, MAX_THINKING_TAG_LENGTH) : "";
    const end = typeof (item as ThinkingTag).end === "string" ? (item as ThinkingTag).end.trim().slice(0, MAX_THINKING_TAG_LENGTH) : "";
    if (!start || !end || start === end || seen.has(`${start}\0${end}`)) continue;
    seen.add(`${start}\0${end}`); tags.push({ start, end });
    if (tags.length >= MAX_THINKING_TAGS) break;
  }
  return tags;
}

export function effectiveThinkingTags(tags: ThinkingTag[] | undefined) {
  return tags ?? DEFAULT_THINKING_TAGS;
}

type Marker = { text: string; action: "open" | "close" | "drop"; closer?: string };
type Channel = { mode: "reasoning" | "content"; buffer: string; closer?: string; trimLeading: boolean };

/**
 * A streaming splitter. Text from the content stream starts as answer and text from the reasoning stream starts
 * as reasoning; a start tag switches a stream to reasoning and its end tag (or, for a stream that began in
 * reasoning, any end tag) switches it back. Stray tags are dropped. A tail that could still become a tag is held
 * until the next chunk or `flush`. With `cross`, a block opened by any start tag is closed by any end tag, for
 * models that open with one format and close with another.
 */
export function createThinkingSplitter(tags: ThinkingTag[], options: { cross?: boolean } = {}) {
  const channels: Record<"reasoning" | "content", Channel> = {
    reasoning: { mode: "reasoning", buffer: "", trimLeading: false },
    content: { mode: "content", buffer: "", trimLeading: false },
  };
  const markersFor = (channel: Channel): Marker[] => channel.mode === "content"
    ? [...tags.map(tag => ({ text: tag.start, action: "open" as const, closer: tag.end })), ...tags.map(tag => ({ text: tag.end, action: "drop" as const }))]
    : [...(channel.closer && !options.cross ? [{ text: channel.closer, action: "close" as const }] : tags.map(tag => ({ text: tag.end, action: "close" as const }))), ...tags.map(tag => ({ text: tag.start, action: "drop" as const }))];

  function emit(out: ThinkingPiece[], channel: Channel, text: string) {
    if (channel.trimLeading) { text = text.replace(/^\s+/, ""); if (text) channel.trimLeading = false; }
    if (!text) return;
    const last = out.at(-1);
    if (last?.kind === channel.mode) last.text += text; else out.push({ kind: channel.mode, text });
  }

  function drain(channel: Channel, final: boolean, out: ThinkingPiece[]) {
    if (!tags.length) { emit(out, channel, channel.buffer); channel.buffer = ""; return; }
    for (;;) {
      const markers = markersFor(channel);
      let found: { index: number; marker: Marker } | undefined;
      for (const marker of markers) {
        const index = channel.buffer.indexOf(marker.text);
        if (index < 0) continue;
        if (!found || index < found.index || index === found.index && marker.text.length > found.marker.text.length) found = { index, marker };
      }
      if (found) {
        emit(out, channel, channel.buffer.slice(0, found.index));
        channel.buffer = channel.buffer.slice(found.index + found.marker.text.length);
        if (found.marker.action === "open") { channel.mode = "reasoning"; channel.closer = found.marker.closer; }
        if (found.marker.action === "close") { channel.mode = "content"; channel.closer = undefined; }
        channel.trimLeading = true;
        continue;
      }
      let hold = 0;
      if (!final) for (const marker of markers) for (let length = Math.min(marker.text.length - 1, channel.buffer.length); length > hold; length -= 1)
        if (marker.text.startsWith(channel.buffer.slice(-length))) { hold = length; break; }
      emit(out, channel, channel.buffer.slice(0, channel.buffer.length - hold));
      channel.buffer = channel.buffer.slice(channel.buffer.length - hold);
      return;
    }
  }

  return {
    push(stream: "reasoning" | "content", text: string): ThinkingPiece[] {
      if (!text) return [];
      const channel = channels[stream]; channel.buffer += text;
      const out: ThinkingPiece[] = []; drain(channel, false, out); return out;
    },
    flush(): ThinkingPiece[] {
      const out: ThinkingPiece[] = [];
      drain(channels.reasoning, true, out); drain(channels.content, true, out);
      return out;
    },
  };
}

/** Splits a complete reply in one go. */
export function splitThinking(content: string, reasoning: string, tags: ThinkingTag[], options: { cross?: boolean } = {}) {
  const splitter = createThinkingSplitter(tags, options);
  const pieces = [...splitter.push("reasoning", reasoning), ...splitter.push("content", content), ...splitter.flush()];
  return {
    reasoning: pieces.filter(piece => piece.kind === "reasoning").map(piece => piece.text).join(""),
    content: pieces.filter(piece => piece.kind === "content").map(piece => piece.text).join(""),
  };
}
