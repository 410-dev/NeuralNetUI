/**
 * Finds a model stuck repeating itself. Small hosted models can loop on a word, a sentence, a paragraph or a group of
 * paragraphs; each kind has an administrator-set threshold of consecutive copies. Only the tail of each stream is
 * inspected, which is where a loop that is still running shows up, and the checks are plain string comparisons so
 * they can run while the response streams. Imports nothing from Node, so the browser can share the types.
 */

export type RepetitionKind = "word" | "sentence" | "paragraph" | "paragraphGroup";
export type RepetitionSegment = "reasoning" | "content" | "tool";
export type RepetitionRule = { enabled: boolean; threshold: number };
export type RepetitionSettings = Record<RepetitionKind, RepetitionRule>;

export type RepetitionFinding = {
  /** Stable for one loop, so a dismissed alert stays dismissed while the same loop keeps growing. */
  id: string;
  segment: RepetitionSegment;
  kind: RepetitionKind;
  count: number;
  /** A short excerpt of the repeated unit. */
  sample: string;
};

export const REPETITION_KINDS: RepetitionKind[] = ["word", "sentence", "paragraph", "paragraphGroup"];
export const REPETITION_LIMITS: Record<RepetitionKind, { min: number; max: number }> = {
  word: { min: 2, max: 500 }, sentence: { min: 2, max: 100 }, paragraph: { min: 2, max: 100 }, paragraphGroup: { min: 2, max: 50 },
};
export const DEFAULT_REPETITION_SETTINGS: RepetitionSettings = {
  word: { enabled: true, threshold: 20 },
  sentence: { enabled: true, threshold: 5 },
  paragraph: { enabled: true, threshold: 5 },
  paragraphGroup: { enabled: true, threshold: 2 },
};

/** Reads stored settings defensively; anything missing or out of range falls back to the defaults. */
export function normalizeRepetitionSettings(value: unknown): RepetitionSettings {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return Object.fromEntries(REPETITION_KINDS.map(kind => {
    const fallback = DEFAULT_REPETITION_SETTINGS[kind];
    const rule = record[kind] && typeof record[kind] === "object" ? record[kind] as Record<string, unknown> : {};
    const threshold = Number(rule.threshold);
    const { min, max } = REPETITION_LIMITS[kind];
    return [kind, {
      enabled: typeof rule.enabled === "boolean" ? rule.enabled : fallback.enabled,
      threshold: Number.isInteger(threshold) && threshold >= min && threshold <= max ? threshold : fallback.threshold,
    }];
  })) as RepetitionSettings;
}

const TAIL_CHARACTERS = 24_000;
const MAX_WORDS = 3_000;
/** Units shorter than these (after collapsing whitespace) are too generic to call a loop, e.g. `}` or `</div>`. */
const MIN_SENTENCE = 8;
const MIN_PARAGRAPH = 16;
const MIN_GROUP = 40;
const MAX_GROUP_SIZE = 12;

const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
const meaningful = (value: string, min: number) => value.length >= min && /[\p{L}\p{N}]/u.test(value);

function hash(value: string) {
  let h = 2166136261;
  for (let index = 0; index < value.length; index += 1) { h ^= value.charCodeAt(index); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

function excerpt(value: string) {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > 140 ? `${flat.slice(0, 137)}…` : flat;
}

/** Longest run of consecutive equal, eligible units. Ineligible units break a run. */
function longestRun(units: string[], eligible: (unit: string) => boolean) {
  let best = { count: 0, unit: "" };
  let run = 0, previous = "";
  for (const unit of units) {
    if (!eligible(unit)) { run = 0; previous = ""; continue; }
    run = unit === previous ? run + 1 : 1; previous = unit;
    if (run > best.count) best = { count: run, unit };
  }
  return best;
}

function wordRun(text: string) {
  const words = text.split(/\s+/).slice(-MAX_WORDS)
    .map(word => word.toLowerCase().replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, ""))
    .filter(Boolean);
  return longestRun(words, word => /[\p{L}\p{N}]/u.test(word));
}

function sentenceRun(text: string) {
  const sentences = text.split(/(?<=[.!?。！？])\s+|\n+/).map(normalize).filter(Boolean);
  return longestRun(sentences, sentence => meaningful(sentence, MIN_SENTENCE));
}

function paragraphsOf(text: string) {
  return text.split(/\n[ \t]*\n+/).map(normalize).filter(Boolean);
}

function paragraphRun(paragraphs: string[]) {
  return longestRun(paragraphs, paragraph => meaningful(paragraph, MIN_PARAGRAPH));
}

/** Longest consecutive repetition of a block of two or more paragraphs that are not all the same paragraph. */
function groupRun(paragraphs: string[]) {
  let best = { count: 0, unit: "" };
  const n = paragraphs.length;
  for (let size = 2; size <= Math.min(MAX_GROUP_SIZE, Math.floor(n / 2)); size += 1) {
    for (let start = 0; start + size * 2 <= n; start += 1) {
      const block = paragraphs.slice(start, start + size);
      if (block.every(item => item === block[0])) continue;
      const joined = block.join("\n\n");
      if (joined.length < MIN_GROUP || !/[\p{L}\p{N}]/u.test(joined)) continue;
      let count = 1;
      while (start + (count + 1) * size <= n && block.every((item, offset) => paragraphs[start + count * size + offset] === item)) count += 1;
      if (count > best.count) best = { count, unit: joined };
      if (count > 1) start += (count - 1) * size;
    }
  }
  return best;
}

function finding(segment: RepetitionSegment, kind: RepetitionKind, run: { count: number; unit: string }): RepetitionFinding {
  return { id: `${segment}:${kind}:${hash(run.unit)}`, segment, kind, count: run.count, sample: excerpt(run.unit) };
}

/** The largest kind of loop found in one stream of text, or undefined. Larger units are reported first. */
export function detectTextRepetition(text: string, segment: RepetitionSegment, settings: RepetitionSettings): RepetitionFinding | undefined {
  const tail = text.length > TAIL_CHARACTERS ? text.slice(-TAIL_CHARACTERS) : text;
  if (!tail.trim()) return undefined;
  const paragraphs = settings.paragraphGroup.enabled || settings.paragraph.enabled ? paragraphsOf(tail) : [];
  if (settings.paragraphGroup.enabled) { const run = groupRun(paragraphs); if (run.count >= settings.paragraphGroup.threshold) return finding(segment, "paragraphGroup", run); }
  if (settings.paragraph.enabled) { const run = paragraphRun(paragraphs); if (run.count >= settings.paragraph.threshold) return finding(segment, "paragraph", run); }
  if (settings.sentence.enabled) { const run = sentenceRun(tail); if (run.count >= settings.sentence.threshold) return finding(segment, "sentence", run); }
  if (settings.word.enabled) { const run = wordRun(tail); if (run.count >= settings.word.threshold) return finding(segment, "word", run); }
  return undefined;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/**
 * Tool calls loop too: the same call made again and again counts like a repeated paragraph, and a sequence of calls
 * made again counts like a repeated paragraph group.
 */
export function detectToolCallRepetition(calls: Array<{ name: string; arguments?: unknown }>, settings: RepetitionSettings): RepetitionFinding | undefined {
  const units = calls.map(call => `${call.name} ${stableStringify(call.arguments ?? {})}`);
  if (units.length < 2) return undefined;
  if (settings.paragraphGroup.enabled) {
    let best = { count: 0, unit: "" };
    const n = units.length;
    for (let size = 2; size <= Math.min(MAX_GROUP_SIZE, Math.floor(n / 2)); size += 1) for (let start = 0; start + size * 2 <= n; start += 1) {
      const block = units.slice(start, start + size);
      if (block.every(item => item === block[0])) continue;
      let count = 1;
      while (start + (count + 1) * size <= n && block.every((item, offset) => units[start + count * size + offset] === item)) count += 1;
      if (count > best.count) best = { count, unit: block.join("\n") };
    }
    if (best.count >= settings.paragraphGroup.threshold) return finding("tool", "paragraphGroup", best);
  }
  if (settings.paragraph.enabled) {
    const run = longestRun(units, () => true);
    if (run.count >= settings.paragraph.threshold) return finding("tool", "paragraph", run);
  }
  return undefined;
}

/** Text inside tool-call arguments is JSON-escaped while it streams; this turns escapes back into line breaks and quotes. */
export function toolArgumentText(raw: string) {
  return raw.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
}
