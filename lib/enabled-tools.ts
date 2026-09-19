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
  mcpConnectionIds: [],
};

/** Keeps only known boolean switches; everything else falls back to the defaults. */
export function normalizeEnabledTools(input: unknown): EnabledTools {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const booleans = Object.fromEntries(Object.entries(DEFAULT_ENABLED_TOOLS).filter(([key]) => key !== "mcpConnectionIds").map(([key, fallback]) => [key, typeof source[key] === "boolean" ? source[key] : fallback]));
  const mcpConnectionIds = Array.isArray(source.mcpConnectionIds)
    ? [...new Set(source.mcpConnectionIds.filter((value): value is string => typeof value === "string" && value.length > 0 && value.length <= 100))].slice(0, 64)
    : [];
  return { ...booleans, mcpConnectionIds } as unknown as EnabledTools;
}
