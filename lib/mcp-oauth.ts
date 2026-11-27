import { createHash, randomBytes } from "node:crypto";
import { db } from "./database.ts";
import { isGoogleAuthorization } from "./mcp-oauth-presets.ts";

/** A sign-in problem with an HTTP status and a message meant for the person (passed through as is). */
export class McpOAuthError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.name = "McpOAuthError"; this.status = status; }
}

/**
 * OAuth 2.0 sign-in for MCP connections (authorization code with PKCE). The account's client id and secret are stored
 * with the connection; after the person signs in, the access token is kept in the connection's credential and the
 * refresh token in its OAuth record, and the access token is renewed shortly before it expires. Nothing here is shown
 * to the browser except whether the connection is signed in.
 */
export type McpOAuthConfig = { clientId: string; clientSecret?: string; authorizationUrl: string; tokenUrl: string; scopes: string[]; refreshToken?: string; expiresAt?: number; account?: string };
type Pending = { userId: string; connectionId: string; verifier: string; redirectUri: string; expiresAt: number };
declare global { var neuralMcpOAuth: { pending: Map<string, Pending>; refreshing: Map<string, Promise<string>> } | undefined; }
const state = globalThis.neuralMcpOAuth ??= { pending: new Map(), refreshing: new Map() };
const PENDING_MS = 10 * 60_000, REFRESH_MARGIN_MS = 90_000;

export function readOAuthConfig(raw: unknown): McpOAuthConfig | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  try {
    const value = JSON.parse(raw) as Partial<McpOAuthConfig>;
    if (!value.clientId || !value.authorizationUrl || !value.tokenUrl) return undefined;
    return { clientId: value.clientId, clientSecret: value.clientSecret || undefined, authorizationUrl: value.authorizationUrl, tokenUrl: value.tokenUrl, scopes: Array.isArray(value.scopes) ? value.scopes.filter(item => typeof item === "string") : [],
      refreshToken: value.refreshToken || undefined, expiresAt: typeof value.expiresAt === "number" ? value.expiresAt : undefined, account: value.account || undefined };
  } catch { return undefined; }
}

function saveTokens(connectionId: string, config: McpOAuthConfig, tokens: { access_token: string; refresh_token?: string; expires_in?: number }) {
  const next: McpOAuthConfig = { ...config, refreshToken: tokens.refresh_token || config.refreshToken, expiresAt: Date.now() + Math.max(60, Number(tokens.expires_in) || 3600) * 1000 };
  db.prepare("UPDATE mcp_connections SET credential=?, oauth=?, updated_at=? WHERE id=?").run(tokens.access_token, JSON.stringify(next), new Date().toISOString(), connectionId);
  return next;
}

async function tokenRequest(config: McpOAuthConfig, params: Record<string, string>) {
  const body = new URLSearchParams({ client_id: config.clientId, ...(config.clientSecret ? { client_secret: config.clientSecret } : {}), ...params });
  const response = await fetch(config.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body, signal: AbortSignal.timeout(20_000), redirect: "error" });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof payload.access_token !== "string") {
    const reason = [payload.error, payload.error_description].filter(item => typeof item === "string").join(": ") || `HTTP ${response.status}`;
    throw new McpOAuthError(`OAuth 토큰을 받지 못했습니다 (${reason}).`, 400);
  }
  return payload as { access_token: string; refresh_token?: string; expires_in?: number };
}

/** Starts a sign-in: the authorization URL to open, with a one-time state bound to this account and connection. */
export function startOAuth(userId: string, connectionId: string, redirectUri: string) {
  const row = db.prepare("SELECT oauth FROM mcp_connections WHERE id=? AND user_id=?").get(connectionId, userId) as { oauth: string | null } | undefined;
  if (!row) throw new McpOAuthError("MCP 연결을 찾을 수 없습니다.", 404);
  const config = readOAuthConfig(row.oauth);
  if (!config) throw new McpOAuthError("OAuth 클라이언트 ID와 인증·토큰 주소를 먼저 저장해 주세요.", 400);
  for (const [key, item] of state.pending) if (item.expiresAt < Date.now()) state.pending.delete(key);
  const verifier = randomBytes(48).toString("base64url"), id = randomBytes(24).toString("base64url");
  state.pending.set(id, { userId, connectionId, verifier, redirectUri, expiresAt: Date.now() + PENDING_MS });
  const url = new URL(config.authorizationUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  if (config.scopes.length) url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", id);
  url.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
  url.searchParams.set("code_challenge_method", "S256");
  if (isGoogleAuthorization(config.authorizationUrl)) { url.searchParams.set("access_type", "offline"); url.searchParams.set("prompt", "consent"); url.searchParams.set("include_granted_scopes", "true"); }
  return url.toString();
}

/** Finishes a sign-in from the provider's redirect: exchanges the code and stores the tokens. */
export async function finishOAuth(stateId: string, code: string) {
  const pending = state.pending.get(stateId);
  state.pending.delete(stateId);
  if (!pending || pending.expiresAt < Date.now()) throw new McpOAuthError("로그인 요청이 만료되었습니다. 다시 시도해 주세요.", 400);
  const userId = pending.userId;
  const row = db.prepare("SELECT oauth FROM mcp_connections WHERE id=? AND user_id=?").get(pending.connectionId, userId) as { oauth: string | null } | undefined;
  const config = row ? readOAuthConfig(row.oauth) : undefined;
  if (!config) throw new McpOAuthError("MCP 연결의 OAuth 설정을 찾을 수 없습니다.", 404);
  const tokens = await tokenRequest(config, { grant_type: "authorization_code", code, redirect_uri: pending.redirectUri, code_verifier: pending.verifier });
  if (!tokens.refresh_token && !config.refreshToken) console.warn(`MCP connection ${pending.connectionId}: the provider returned no refresh token; it will need signing in again when the access token expires.`);
  saveTokens(pending.connectionId, config, tokens);
  return pending.connectionId;
}

/** The access token to send: renewed with the refresh token shortly before it expires (one renewal at a time). */
export async function oauthAccessToken(connectionId: string): Promise<string | undefined> {
  const row = db.prepare("SELECT credential, oauth FROM mcp_connections WHERE id=?").get(connectionId) as { credential: string; oauth: string | null } | undefined;
  if (!row) return undefined;
  const config = readOAuthConfig(row.oauth);
  // A connection without an OAuth client keeps working with a pasted token, as before.
  if (!config) return row.credential || undefined;
  if (!row.credential && !config.refreshToken) throw new McpOAuthError("이 MCP 연결은 아직 로그인되지 않았습니다. MCP 설정에서 로그인해 주세요.", 401);
  if (row.credential && (!config.expiresAt || config.expiresAt - REFRESH_MARGIN_MS > Date.now())) return row.credential;
  if (!config.refreshToken) throw new McpOAuthError("로그인이 만료되었습니다. MCP 설정에서 다시 로그인해 주세요.", 401);
  const running = state.refreshing.get(connectionId);
  if (running) return running;
  const refresh = tokenRequest(config, { grant_type: "refresh_token", refresh_token: config.refreshToken })
    .then(tokens => { saveTokens(connectionId, config, tokens); return tokens.access_token; })
    .catch(error => { throw new McpOAuthError(`로그인을 갱신하지 못했습니다. MCP 설정에서 다시 로그인해 주세요. (${error instanceof Error ? error.message : String(error)})`, 401); })
    .finally(() => state.refreshing.delete(connectionId));
  state.refreshing.set(connectionId, refresh);
  return refresh;
}
