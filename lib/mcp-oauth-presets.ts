/**
 * OAuth settings filled in for well-known MCP servers, safe to import in the browser. Google's Workspace MCP servers
 * (gmailmcp/calendarmcp.googleapis.com) use Google's OAuth endpoints and per-product scopes.
 */
export type McpOAuthPreset = { authorizationUrl: string; tokenUrl: string; scopes: string[] };

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth", GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_SCOPES: Record<string, string[]> = {
  "gmailmcp.googleapis.com": ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose", "https://www.googleapis.com/auth/gmail.modify"],
  "calendarmcp.googleapis.com": ["https://www.googleapis.com/auth/calendar.calendarlist.readonly", "https://www.googleapis.com/auth/calendar.events.freebusy", "https://www.googleapis.com/auth/calendar.events.readonly", "https://www.googleapis.com/auth/calendar.events"],
};

export function mcpOAuthPreset(url: string): McpOAuthPreset | undefined {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { return undefined; }
  if (GOOGLE_SCOPES[host]) return { authorizationUrl: GOOGLE_AUTH, tokenUrl: GOOGLE_TOKEN, scopes: GOOGLE_SCOPES[host] };
  if (host.endsWith(".googleapis.com")) return { authorizationUrl: GOOGLE_AUTH, tokenUrl: GOOGLE_TOKEN, scopes: [] };
  return undefined;
}

/** Google issues a refresh token only when asked for offline access with consent. */
export function isGoogleAuthorization(url: string) {
  try { return new URL(url).hostname === "accounts.google.com"; } catch { return false; }
}

export const MCP_OAUTH_CALLBACK_PATH = "/api/mcp-connections/oauth/callback";
