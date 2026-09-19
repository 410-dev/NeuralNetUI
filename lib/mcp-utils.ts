import { isIP } from "node:net";

export type McpAddressClass = "public" | "private" | "blocked";

export function classifyMcpAddress(address:string):McpAddressClass {
  const value=address.toLowerCase().split("%")[0];
  // Do not let IPv4-mapped IPv6 literals bypass the IPv4 range checks.
  if(value.startsWith("::ffff:"))return"blocked";
  if(isIP(value)===4){const parts=value.split(".").map(Number);if(parts[0]===0||parts[0]>=224||parts[0]===169&&parts[1]===254)return"blocked";if(parts[0]===10||parts[0]===127||parts[0]===172&&parts[1]>=16&&parts[1]<=31||parts[0]===192&&parts[1]===168)return"private";return"public";}
  if(value==="::"||value.startsWith("fe8")||value.startsWith("fe9")||value.startsWith("fea")||value.startsWith("feb")||value.startsWith("ff"))return"blocked";
  if(value==="::1"||value.startsWith("fc")||value.startsWith("fd"))return"private";
  return"public";
}

export function mcpToolAlias(connectionId: string, toolName: string) {
  const safe = toolName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 45) || "tool";
  return `mcp_${connectionId.replace(/-/g, "").slice(0, 8)}_${safe}`.slice(0, 64);
}
