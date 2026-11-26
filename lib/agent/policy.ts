/**
 * Which tool calls the agent may make on its own. Calls the person starts in the agent chat follow each tool's
 * normal approval; automatic runs (subagents, scheduled work, turns the agent starts itself) follow these rules.
 */
export type AgentToolDecision = "allow" | "ask";
export type AgentToolRule = { read?: AgentToolDecision; write?: AgentToolDecision; tools?: Record<string, AgentToolDecision> };
export type AgentToolRules = Record<string, AgentToolRule>;

/** Providers that need the person's browser (code runs there; questions and location are answered there). */
export const BROWSER_ONLY_PROVIDERS = new Set(["code-runner", "location", "multiple-choice"]);
/** The agent's own tools are always allowed. */
export const AGENT_PROVIDER_ID = "agent";

const WRITE_WORDS = /(click|type|fill|submit|press|select|upload|download|write|save|delete|remove|create|update|send|post|move|rename)/i;

/**
 * Whether one call only reads. MCP tools say so with `readOnlyHint`; a tool that does not say is treated as writing.
 * Built-in tools are classified here, by function and, for storage, by the action the call asks for.
 */
export function isReadOnlyCall(providerId: string, functionName: string, args: Record<string, unknown>, readOnlyHint?: boolean) {
  if (providerId.startsWith("mcp:")) return readOnlyHint === true;
  switch (providerId) {
    case "web-search": case "page-visit": case "current-time": case "artifact": return true;
    case "youtube": return functionName !== "download_youtube_video";
    case "storage": return ["search", "read"].includes(String(args.action || "").toLowerCase());
    case "browser": return !WRITE_WORDS.test(functionName.replace(/^browser_/, ""));
    default: return false;
  }
}

/** A provider's rule for one call: a per-tool exception first, then its read or write switch. Unset reads are allowed; unset writes ask. */
export function decideAgentCall(rules: AgentToolRules | undefined, providerId: string, sourceName: string, readOnly: boolean): AgentToolDecision {
  if (providerId === AGENT_PROVIDER_ID) return "allow";
  const rule = rules?.[providerId];
  const exception = rule?.tools?.[sourceName];
  if (exception) return exception;
  return readOnly ? rule?.read ?? "allow" : rule?.write ?? "ask";
}
