/**
 * Finding and cleaning YouTube subtitles from yt-dlp's video info. Pure functions only, so they can be tested without
 * a network. Ported from the youtube-subtitle MCP server that used to live in mcp-extensions.
 */

export const YOUTUBE_HOSTS = new Set([
  "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com",
  "youtu.be", "youtube-nocookie.com", "www.youtube-nocookie.com",
]);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const ID_PATH_PREFIXES = new Set(["shorts", "live", "embed", "v"]);
const FORMAT_ORDER = ["json3", "vtt", "srv3", "srv1"];

export class SubtitleError extends Error {}

/** A canonical watch URL and the video id. Only YouTube links or a bare 11-character id are accepted. */
export function videoUrl(value: string): { url: string; id: string } {
  const text = (value || "").trim();
  if (VIDEO_ID.test(text)) return { url: `https://www.youtube.com/watch?v=${text}`, id: text };
  let parsed: URL;
  try { parsed = new URL(text.includes("://") ? text : `https://${text}`); }
  catch { throw new SubtitleError("Only YouTube video links (youtube.com, youtu.be) or an 11-character video id are supported."); }
  const host = parsed.hostname.toLowerCase();
  if (!["http:", "https:"].includes(parsed.protocol) || !YOUTUBE_HOSTS.has(host)) throw new SubtitleError("Only YouTube video links (youtube.com, youtu.be) or an 11-character video id are supported.");
  const segments = parsed.pathname.split("/").filter(Boolean);
  let candidate = "";
  if (host === "youtu.be") candidate = segments[0] || "";
  else if (!segments.length || segments[0] === "watch") candidate = parsed.searchParams.get("v") || "";
  else if (ID_PATH_PREFIXES.has(segments[0]) && segments.length > 1) candidate = segments[1];
  if (!VIDEO_ID.test(candidate)) throw new SubtitleError("The link does not point to a single YouTube video. Playlists and channels are not supported.");
  return { url: `https://www.youtube.com/watch?v=${candidate}`, id: candidate };
}

export type SubtitleFormat = { ext?: string; url?: string; name?: string };
export type VideoInfo = {
  title?: string; channel?: string; uploader?: string; duration?: number; upload_date?: string; language?: string | null;
  subtitles?: Record<string, SubtitleFormat[]>; automatic_captions?: Record<string, SubtitleFormat[]>;
  filesize?: number; filesize_approx?: number; requested_formats?: Array<{ filesize?: number; filesize_approx?: number }>;
  resolution?: string; format_id?: string;
};
export type Track = { language: string; kind: "manual" | "auto"; translated: boolean; formats: SubtitleFormat[] };

const base = (code: string) => code.toLowerCase().replace(/-orig$/, "").split("-")[0];

function find(tracks: Record<string, SubtitleFormat[]>, wanted: string) {
  const lower = wanted.toLowerCase();
  const keys = Object.keys(tracks);
  return keys.find(key => key.toLowerCase() === lower)
    ?? keys.find(key => base(key) === base(lower) && !key.toLowerCase().endsWith("-orig") && key !== "live_chat");
}

/** Uploaded subtitles first, then YouTube's captions in the spoken language, and only then a machine translation. */
export function chooseTrack(info: VideoInfo, requested = "", preferred: string[] = []): Track {
  const manual = Object.fromEntries(Object.entries(info.subtitles || {}).filter(([key, value]) => key !== "live_chat" && value?.length));
  const auto = Object.fromEntries(Object.entries(info.automatic_captions || {}).filter(([, value]) => value?.length));
  let spoken = (info.language || "").toLowerCase();
  const originals = Object.keys(auto).filter(key => key.toLowerCase().endsWith("-orig"));
  const originalFor = (code: string) => originals.find(key => base(key) === base(code));
  const spokenAuto = spoken ? originalFor(spoken) : originals[0];
  if (!spoken && spokenAuto) spoken = base(spokenAuto);
  const manualTrack = (code: string): Track | undefined => { const key = code ? find(manual, code) : undefined; return key ? { language: key, kind: "manual", translated: false, formats: manual[key] } : undefined; };
  const autoTrack = (code: string): Track | undefined => {
    if (!code) return undefined;
    const original = originalFor(code);
    if (original) return { language: original.replace(/-orig$/, ""), kind: "auto", translated: false, formats: auto[original] };
    const key = find(auto, code);
    return key ? { language: key, kind: "auto", translated: spoken ? base(key) !== base(spoken) : true, formats: auto[key] } : undefined;
  };
  if (requested) {
    const found = manualTrack(requested) || autoTrack(requested);
    if (!found) throw new SubtitleError(`No subtitles in '${requested}'. Use list_youtube_subtitles to see the available languages.`);
    return found;
  }
  for (const code of [spoken, ...preferred]) { const found = manualTrack(code); if (found) return found; }
  const firstManual = Object.keys(manual)[0];
  if (firstManual) return { language: firstManual, kind: "manual", translated: false, formats: manual[firstManual] };
  const spokenFound = autoTrack(spoken) || (spokenAuto ? { language: spokenAuto.replace(/-orig$/, ""), kind: "auto" as const, translated: false, formats: auto[spokenAuto] } : undefined);
  if (spokenFound) return spokenFound;
  for (const code of preferred) { const found = autoTrack(code); if (found) return found; }
  throw new SubtitleError("This video has no subtitles or automatic captions.");
}

export function pickFormat(track: Track): SubtitleFormat & { url: string; ext: string } {
  const byExt = new Map(track.formats.filter(item => item.url).map(item => [item.ext, item]));
  for (const ext of FORMAT_ORDER) { const found = byExt.get(ext); if (found?.url) return { ...found, url: found.url, ext }; }
  throw new SubtitleError("The subtitles are only offered in formats this tool cannot read.");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
function unescapeHtml(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") { const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10); return Number.isFinite(code) ? String.fromCodePoint(code) : match; }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}
const clean = (text: string) => unescapeHtml(text.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

export type Cue = [number, string];

export function parseJson3(raw: string): Cue[] {
  const events = (JSON.parse(raw) as { events?: Array<{ segs?: Array<{ utf8?: string }>; tStartMs?: number }> }).events || [];
  const cues: Cue[] = [];
  for (const event of events) {
    if (!event.segs?.length) continue;
    const text = clean(event.segs.map(segment => segment.utf8 || "").join(""));
    if (text) cues.push([Math.floor(event.tStartMs || 0), text]);
  }
  return cues;
}

const TIMING = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})\s+-->/;

/** WebVTT cues. Rolling automatic captions repeat the previous line in every cue; repeats are dropped. */
export function parseVtt(raw: string): Cue[] {
  const cues: Cue[] = [];
  let recent: string[] = [];
  for (const block of raw.split(/\r?\n\r?\n/)) {
    const lines = block.trim().split(/\r?\n/);
    const timing = lines.findIndex(line => TIMING.test(line));
    if (timing < 0) continue;
    const [, hours, minutes, seconds, millis] = TIMING.exec(lines[timing])!;
    const start = ((Number(hours || 0) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000 + Number(millis);
    for (const line of lines.slice(timing + 1)) {
      const text = clean(line);
      if (text && !recent.includes(text)) { cues.push([start, text]); recent = [...recent, text].slice(-3); }
    }
  }
  return cues;
}

/** YouTube's XML timed text (srv1 uses seconds in `start`, srv3 milliseconds in `t`). */
export function parseSrv(raw: string): Cue[] {
  const cues: Cue[] = [];
  for (const match of raw.matchAll(/<(?:text|p)\b([^>]*)>([\s\S]*?)<\/(?:text|p)>/g)) {
    const [, attributes, body] = match;
    const ms = /\bt="(\d+)"/.exec(attributes)?.[1];
    const seconds = /\bstart="([\d.]+)"/.exec(attributes)?.[1];
    const start = ms ? Number(ms) : seconds ? Math.floor(Number(seconds) * 1000) : 0;
    const text = clean(body);
    if (text) cues.push([start, text]);
  }
  return cues;
}

export function parseSubtitles(raw: string, ext: string): Cue[] {
  const cues = ext === "json3" ? parseJson3(raw) : ext === "vtt" ? parseVtt(raw) : parseSrv(raw);
  const result: Cue[] = [];
  for (const cue of cues) if (!result.length || result.at(-1)![1] !== cue[1]) result.push(cue);
  return result;
}

export function clock(milliseconds: number) {
  let seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600); seconds -= hours * 3600;
  const minutes = Math.floor(seconds / 60); seconds -= minutes * 60;
  const two = (value: number) => String(value).padStart(2, "0");
  return hours ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}

/** Paragraphs split after a pause of 2.5 s or about 600 characters; with timestamps each starts with its time. */
export function transcriptText(cues: Cue[], timestamps = false) {
  const paragraphs: Array<[number, string[]]> = [];
  let previous: number | undefined;
  for (const [start, text] of cues) {
    const current = paragraphs.at(-1);
    const long = current !== undefined && current[1].reduce((n, part) => n + part.length + 1, 0) > 600;
    const pause = previous !== undefined && start - previous > 2500;
    if (!current || long || pause) paragraphs.push([start, [text]]); else current[1].push(text);
    previous = start;
  }
  return paragraphs.map(([start, parts]) => `${timestamps ? `[${clock(start)}] ` : ""}${parts.join(" ")}`).join("\n\n");
}

/** One window of the transcript. The cut moves back to the last whitespace so words are not split. */
export function page(text: string, offset: number, limit: number): { text: string; next?: number } {
  const start = Math.max(0, Math.min(offset, text.length));
  let end = start + Math.max(1, limit);
  if (end >= text.length) return { text: text.slice(start) };
  const space = text.lastIndexOf(" ", end);
  if (space > start + Math.floor(limit / 2)) end = space;
  return { text: text.slice(start, end), next: end };
}

export function languagesSummary(info: VideoInfo) {
  const manual = Object.keys(info.subtitles || {}).filter(key => key !== "live_chat").sort();
  const auto = Object.keys(info.automatic_captions || {});
  const spoken = auto.filter(key => key.toLowerCase().endsWith("-orig")).map(key => key.replace(/-orig$/, "")).sort();
  return { manual, autoSpoken: spoken, autoTranslated: Math.max(0, auto.length - spoken.length) };
}

export function infoHeader(info: VideoInfo, canonical: string) {
  const lines = [`Title: ${info.title || "(unknown)"}`, `Channel: ${info.channel || info.uploader || "(unknown)"}`];
  if (info.duration) lines.push(`Duration: ${clock(Math.floor(info.duration) * 1000)}`);
  if (info.upload_date) { const date = String(info.upload_date); lines.push(`Uploaded: ${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`); }
  lines.push(`URL: ${canonical}`);
  return lines;
}

/** Best video plus best audio (merged when ffmpeg is available), or the best single file. */
export function formatSelector(maxHeight: number | undefined, canMerge: boolean) {
  if (!canMerge) return maxHeight ? `b[height<=${maxHeight}]/b` : "b";
  return maxHeight ? `bv*[height<=${maxHeight}]+ba/b[height<=${maxHeight}]/bv*+ba/b` : "bv*+ba/b";
}

export function estimatedSize(info: VideoInfo) {
  const formats = info.requested_formats?.length ? info.requested_formats : [info];
  const sizes = formats.map(item => item.filesize || item.filesize_approx);
  return sizes.length && sizes.every(size => typeof size === "number" && size > 0) ? Math.floor(sizes.reduce<number>((n, size) => n + (size || 0), 0)) : undefined;
}
