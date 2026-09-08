import type { AppearancePreferences, AccentPaletteId } from "./types.ts";

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
  accentPalette: "blue",
  accentColor: "#4d7fd8",
  streamReveal: "instant",
  streamPacing: "immediate",
  streamChunkSize: 3,
};

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function normalizeHexColor(value: string | undefined, fallback = DEFAULT_APPEARANCE.accentColor): string {
  const text = (value || "").trim().replace(/^#/, "");
  const expanded = text.length === 3 ? [...text].map((digit) => digit + digit).join("") : text;
  return /^[0-9a-fA-F]{6}$/.test(expanded) ? `#${expanded.toLowerCase()}` : fallback;
}

/** The colour the interface should use, resolving the custom palette to its saved hex. */
export function accentColorOf(preferences: Partial<AppearancePreferences> | undefined): string {
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

export function normalizeAppearance(input: Partial<AppearancePreferences> | undefined): AppearancePreferences {
  const palette = ACCENT_PALETTES.some((entry) => entry.id === input?.accentPalette) || input?.accentPalette === "custom"
    ? input!.accentPalette! : DEFAULT_APPEARANCE.accentPalette;
  return {
    accentPalette: palette,
    accentColor: normalizeHexColor(input?.accentColor),
    streamReveal: input?.streamReveal === "fade" ? "fade" : "instant",
    streamPacing: input?.streamPacing === "chunked" ? "chunked" : "immediate",
    streamChunkSize: clamp(Math.floor(Number(input?.streamChunkSize) || DEFAULT_APPEARANCE.streamChunkSize), 1, 24),
  };
}
