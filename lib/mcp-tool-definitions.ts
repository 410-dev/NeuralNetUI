/**
 * How an MCP connection's tool definitions reach the model. Some servers (Google's Workspace MCP servers, for one)
 * describe every field at manual length, and the definitions alone can take tens of thousands of tokens on every
 * request.
 *
 * - full: as the server sends them.
 * - trimmed: tool descriptions and field descriptions cut at a length; types, required fields and enums stay.
 * - on_demand: only names and a one-line summary are sent, with one extra function that puts the full definitions of
 *   the tools the model is about to use into its tool list (from the next request of the reply on, and in later
 *   replies of the conversation, so compaction cannot take them away). A call to a tool whose definition was not read
 *   in this conversation is not run: its definition is added instead and the model calls again.
 */
export type ToolDefinitionMode = "full" | "trimmed" | "on_demand";
export const TOOL_DEFINITION_MODES: readonly ToolDefinitionMode[] = ["full", "trimmed", "on_demand"];
export const DETAILS_TOOL = "get_tool_details";
export const TRIM_LIMITS = { description: 1000, field: 300 } as const;
const SUMMARY_LIMIT = 160;

function cut(text: string, limit: number) {
  const clean = text.trim();
  return clean.length <= limit ? clean : `${clean.slice(0, limit).trimEnd()}…`;
}

/** A schema with every "description" longer than the limit cut; structure, types, enums and required lists stay. */
export function trimSchema<T>(schema: T, limit: number = TRIM_LIMITS.field): T {
  const walk = (value: unknown, key?: string): unknown => {
    if (typeof value === "string") return key === "description" ? cut(value, limit) : value;
    if (Array.isArray(value)) return value.map(item => walk(item));
    if (value && typeof value === "object") {
      // "properties" maps field names to schemas: a field called "description" is a schema, not a description.
      return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, key === "properties" ? walk(item) : walk(item, name)]));
    }
    return value;
  };
  return walk(schema) as T;
}

export function trimDescription(text: string, limit: number = TRIM_LIMITS.description) { return cut(text, limit); }

/** The first sentence (or line) of a description, for the on-demand list. */
export function summarize(text: string) {
  const first = text.trim().split(/\n\s*\n|\n|(?<=[.!?])\s+/)[0] || "";
  return cut(first, SUMMARY_LIMIT);
}

/**
 * Tool names (as the server calls them) whose full definitions were already returned in this conversation: by the
 * details function, or by a call that was held back to show its definition. `prefix` is the connection's namespace.
 */
export function toolsWithDetails(history: Array<{ name: string; status?: string; arguments?: unknown; result?: unknown }>, prefix: string): Set<string> {
  const seen = new Set<string>();
  for (const event of history) {
    if (!event.name.startsWith(prefix) || event.status === "error") continue;
    const result = event.result && typeof event.result === "object" ? event.result as { tools?: Array<{ name?: unknown }> } : undefined;
    for (const tool of result?.tools || []) if (typeof tool.name === "string") seen.add(tool.name);
  }
  return seen;
}

/** Virtual computer tools sent in full even on demand: most tasks start with them, so they cost no extra round. */
export const VM_CORE_TOOLS = new Set(["shell_run", "browser_navigate", "browser_markdown"]);

/** A details request names a tool exactly, or a group with a trailing * ("browser_*"). */
export function matchesToolName(pattern: string, name: string) {
  return pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : pattern === name;
}