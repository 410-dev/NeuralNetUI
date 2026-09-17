import type { EnabledTools } from "./types.ts";

/** Composer tool switches for an account that has never changed them. */
export const DEFAULT_ENABLED_TOOLS: EnabledTools = {
  internetSearch: false,
  pageVisit: false,
  browser: false,
  storageAccess: true,
  currentTime: true,
  location: false,
  multipleChoice: true,
  hostComputer: false,
};

/** Keeps only known boolean switches; everything else falls back to the defaults. */
export function normalizeEnabledTools(input: unknown): EnabledTools {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return Object.fromEntries(Object.entries(DEFAULT_ENABLED_TOOLS).map(([key, fallback]) => [key, typeof source[key] === "boolean" ? source[key] : fallback])) as unknown as EnabledTools;
}
