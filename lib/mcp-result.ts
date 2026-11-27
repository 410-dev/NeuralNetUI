/**
 * Makes MCP tool results smaller before they reach the model (and the stored tool events).
 *
 * - JSON is re-serialized without indentation or escapes (`<`), which roughly halves pretty-printed results.
 * - Mail bodies: an HTML body is dropped when the message has a plain-text body, and turned into text when it does not.
 *   Gmail's get_thread returned HTML next to the plain text even without asking for it (2026-11-27), at 10-20 times
 *   the size.
 * - Long runs of encoded data (base64, data: URLs) are replaced by a note.
 * - Each call's text is capped, with a note asking for a narrower request.
 */

/** Characters of text one MCP call may hand the model (about 12-15k tokens). */
export const MAX_MODEL_RESULT_CHARS = 50_000;
const ENCODED_MIN_CHARS = 2_000;

const HTML_KEYS = ["htmlBody", "html_body", "bodyHtml", "body_html"];
const TEXT_KEYS = ["plaintextBody", "plainTextBody", "textBody", "text_body", "bodyText", "body_text"];

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", zwnj: "", zwj: "", shy: "", ensp: " ", emsp: " ", thinsp: " ", hellip: "…", mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", middot: "·", copy: "©", reg: "®", trade: "™" };

/** Readable text of an HTML document: no head, styles, scripts, comments or tags; links keep their address. */
export function htmlToText(html: string) {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(head|style|script|noscript|title|svg)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi, (_, href: string, label: string) => {
      const text = label.replace(/<[^>]*>/g, "").trim();
      return !text ? "" : /^(https?:|mailto:)/i.test(href) && !text.includes(href) && href.length <= 200 ? `${text} (${href})` : text;
    })
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote|section|article|header|footer)\s*>/gi, "\n")
    .replace(/<(td|th)\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
      if (name[0] === "#") {
        const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
      }
      return ENTITIES[name.toLowerCase()] ?? entity;
    })
    .replace(/[​-‍⁠﻿͏]/g, "")
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function encodedNote(value: string) {
  if (value.length < ENCODED_MIN_CHARS) return undefined;
  if (/^data:[^,]{1,100},/.test(value)) return `[${value.slice(5, value.indexOf(","))} data, ${value.length} characters omitted]`;
  return /^[A-Za-z0-9+/=_-]+$/.test(value) ? `[encoded data, ${value.length} characters omitted]` : undefined;
}

/** A copy of a JSON value with mail HTML and encoded blobs reduced as described above. */
export function slimJson(value: unknown): unknown {
  if (typeof value === "string") return encodedNote(value) ?? value;
  if (Array.isArray(value)) return value.map(slimJson);
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const htmlKey = HTML_KEYS.find(key => typeof source[key] === "string" && source[key]);
  const hasText = TEXT_KEYS.some(key => typeof source[key] === "string" && (source[key] as string).trim());
  for (const [key, item] of Object.entries(source)) {
    if (key === htmlKey) {
      // Kept in place of the HTML, so the model can tell the body came from it.
      if (!hasText) out[`${key}AsText`] = htmlToText(item as string);
      continue;
    }
    out[key] = slimJson(item);
  }
  return out;
}

/** The JSON value in a text result, if the whole text is JSON. */
export function parseJsonText(text: string): { value: unknown } | undefined {
  const trimmed = text.trim();
  if (!/^[[{]/.test(trimmed)) return undefined;
  try { return { value: JSON.parse(trimmed) }; } catch { return undefined; }
}

/** Compact, slimmed JSON text; other text as it is. */
export function slimText(text: string) {
  const json = parseJsonText(text);
  return json ? JSON.stringify(slimJson(json.value)) : text;
}

/** Shares MAX_MODEL_RESULT_CHARS among the parts of one call, in order. */
export function resultBudget(limit = MAX_MODEL_RESULT_CHARS) {
  let left = limit;
  return (text: string) => {
    if (text.length <= left) { left -= text.length; return text; }
    const kept = Math.max(0, left); left = 0;
    return `${text.slice(0, kept)}\n[Result truncated: showing ${kept.toLocaleString("en-US")} of ${text.length.toLocaleString("en-US")} characters. For the rest, ask for less at a time: filters, a smaller page, one item, or a plain-text or summary format.]`;
  };
}
