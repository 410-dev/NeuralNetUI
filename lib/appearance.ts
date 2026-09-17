import { normalizeGreetings } from "./greetings.ts";
import type { AppearancePreferences, AccentPaletteId, LoginAppearance, Locale } from "./types.ts";

/** Named accent choices. The custom entry carries no colour of its own; the saved hex supplies it. */
export const ACCENT_PALETTES: Array<{ id: AccentPaletteId; hex: string }> = [
  { id: "blue", hex: "#4d7fd8" },
  { id: "violet", hex: "#7b6ae0" },
  { id: "teal", hex: "#3aa79a" },
  { id: "amber", hex: "#c8912f" },
  { id: "rose", hex: "#c9647f" },
  { id: "graphite", hex: "#7d838d" },
];

export const DEFAULT_APPEARANCE: AppearancePreferences = {
  lmStudioProgress: "both",
  accentPalette: "blue",
  accentColor: "#4d7fd8",
  streamReveal: "instant",
  streamPacing: "immediate",
  streamChunkSize: 3,
  showReasoningNotes: true,
  showModelWeights: false,
  reasoningNotes: {},
  greetings: {},
};

/** The sign-in screen shares the accent vocabulary but keeps its own workspace-wide choice. */
export const DEFAULT_LOGIN_APPEARANCE: LoginAppearance = {
  accentPalette: DEFAULT_APPEARANCE.accentPalette,
  accentColor: DEFAULT_APPEARANCE.accentColor,
};

/** Effort keys that share one description. "off" and "none" are both the fast path. */
export const REASONING_NOTE_KEYS = ["off", "on", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningNoteKey = (typeof REASONING_NOTE_KEYS)[number];

export const reasoningNoteKey = (effort: string): ReasoningNoteKey | undefined => {
  const key = effort === "none" ? "off" : effort;
  return (REASONING_NOTE_KEYS as readonly string[]).includes(key) ? key as ReasoningNoteKey : undefined;
};

const DEFAULT_NOTES: Record<ReasoningNoteKey, [string, string]> = {
  off: ["Instant answers for everyday questions", "일반적인 질문을 위한 즉시 응답"],
  on: ["Deliberation for complex questions", "복잡한 질문을 위한 사고"],
  minimal: ["Answers with almost no deliberation", "거의 사고하지 않고 답변"],
  low: ["Suited to everyday questions", "일반적인 질문에 적합"],
  medium: ["Suited to moderately complex questions", "다소 복잡한 질문에 적합"],
  high: ["Suited to very complex questions", "아주 복잡한 질문에 적합"],
  xhigh: ["Careful deliberation on very complex questions", "아주 복잡한 질문에 대해 심사숙고"],
  max: ["Uses as much deliberation as the model allows", "가능한 모든 사고를 사용"],
};

export const defaultReasoningNote = (key: ReasoningNoteKey, locale: Locale) => DEFAULT_NOTES[key][locale === "ko" ? 1 : 0];

/**
 * Description shown beside a reasoning choice. A saved override wins; otherwise the built-in
 * default for the active language is used, so switching language keeps untouched notes readable.
 */
export function reasoningNote(effort: string | undefined, preferences: Partial<AppearancePreferences> | undefined, locale: Locale): string {
  const key = reasoningNoteKey(effort || "");
  if (!key) return "";
  const override = preferences?.reasoningNotes?.[key];
  return typeof override === "string" && override.trim() ? override.trim() : defaultReasoningNote(key, locale);
}


const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function normalizeHexColor(value: string | undefined, fallback = DEFAULT_APPEARANCE.accentColor): string {
  const text = (value || "").trim().replace(/^#/, "");
  const expanded = text.length === 3 ? [...text].map((digit) => digit + digit).join("") : text;
  return /^[0-9a-fA-F]{6}$/.test(expanded) ? `#${expanded.toLowerCase()}` : fallback;
}

/** The colour the interface should use, resolving the custom palette to its saved hex. */
export function accentColorOf(preferences: Partial<Pick<AppearancePreferences, "accentPalette" | "accentColor">> | undefined): string {
  const id = preferences?.accentPalette || DEFAULT_APPEARANCE.accentPalette;
  const named = ACCENT_PALETTES.find((palette) => palette.id === id);
  return normalizeHexColor(named ? named.hex : preferences?.accentColor);
}

export function hexToRgb(hex: string): [number, number, number] {
  const value = normalizeHexColor(hex).slice(1);
  return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16)) as [number, number, number];
}

function rgbToHsl(red: number, green: number, blue: number): [number, number, number] {
  const [r, g, b] = [red / 255, green / 255, blue / 255];
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const span = max - min;
  const lightness = (max + min) / 2;
  if (!span) return [0, 0, lightness * 100];
  const saturation = span / (1 - Math.abs(2 * lightness - 1));
  const hue = max === r ? ((g - b) / span + (g < b ? 6 : 0)) : max === g ? (b - r) / span + 2 : (r - g) / span + 4;
  return [hue * 60, saturation * 100, lightness * 100];
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const s = saturation / 100; const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const section = ((hue % 360) + 360) % 360 / 60;
  const second = chroma * (1 - Math.abs(section % 2 - 1));
  const [r, g, b] = section < 1 ? [chroma, second, 0] : section < 2 ? [second, chroma, 0] : section < 3 ? [0, chroma, second]
    : section < 4 ? [0, second, chroma] : section < 5 ? [second, 0, chroma] : [chroma, 0, second];
  const offset = l - chroma / 2;
  return [r, g, b].map((channel) => Math.round((channel + offset) * 255)) as [number, number, number];
}

/**
 * CSS custom properties for one accent colour. The channel triples let the stylesheet build
 * translucent accents with `rgb(var(--accent-rgb) / .2)` instead of hardcoding a hue.
 */
export function accentVariables(hex: string): Record<string, string> {
  const base = normalizeHexColor(hex);
  const [red, green, blue] = hexToRgb(base);
  const [hue, saturation, lightness] = rgbToHsl(red, green, blue);
  // Greys carry no hue, so leave their saturation alone rather than tinting them.
  const brighterSaturation = saturation > 4 ? clamp(saturation + 8, 0, 100) : saturation;
  const bright = hslToRgb(hue, brighterSaturation, clamp(lightness + 15, 0, 88));
  return {
    "--accent": base,
    "--accent-rgb": `${red} ${green} ${blue}`,
    "--accent-bright": `rgb(${bright.join(" ")})`,
    "--accent-bright-rgb": bright.join(" "),
  };
}

/**
 * Next slice of text to show. Chunked pacing releases a fixed number of characters per step so
 * bursty snapshots read as even typing; rewritten content resynchronises immediately.
 */
export function revealStep(shown: string, target: string, chunkSize: number): string {
  if (!target.startsWith(shown)) return target;
  if (shown.length >= target.length) return target;
  return target.slice(0, Math.min(target.length, shown.length + Math.max(1, Math.floor(chunkSize))));
}

const knownPalette = (value: string | undefined): value is AccentPaletteId =>
  value === "custom" || ACCENT_PALETTES.some((entry) => entry.id === value);

export function normalizeLoginAppearance(input: Partial<LoginAppearance> | undefined): LoginAppearance {
  return {
    accentPalette: knownPalette(input?.accentPalette) ? input!.accentPalette! : DEFAULT_LOGIN_APPEARANCE.accentPalette,
    accentColor: normalizeHexColor(input?.accentColor),
  };
}

export function normalizeAppearance(input: Partial<AppearancePreferences> | undefined): AppearancePreferences {
  const palette = knownPalette(input?.accentPalette) ? input!.accentPalette! : DEFAULT_APPEARANCE.accentPalette;
  return {
    lmStudioProgress: ["text", "percent", "donut", "both"].includes(input?.lmStudioProgress || "") ? input!.lmStudioProgress! : "both",
    accentPalette: palette,
    accentColor: normalizeHexColor(input?.accentColor),
    streamReveal: input?.streamReveal === "fade" ? "fade" : "instant",
    streamPacing: input?.streamPacing === "chunked" ? "chunked" : "immediate",
    streamChunkSize: clamp(Math.floor(Number(input?.streamChunkSize) || DEFAULT_APPEARANCE.streamChunkSize), 1, 24),
    showReasoningNotes: input?.showReasoningNotes !== false,
    showModelWeights: input?.showModelWeights === true,
    reasoningNotes: normalizeReasoningNotes(input?.reasoningNotes),
    greetings: normalizeGreetings(input?.greetings),
  };
}

/** Keeps only known effort keys and trims blanks, so a stray note cannot bloat the preference blob. */
export function normalizeReasoningNotes(input: unknown): Record<string, string> {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const notes: Record<string, string> = {};
  for (const key of REASONING_NOTE_KEYS) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) notes[key] = value.trim().slice(0, 200);
  }
  return notes;
}
