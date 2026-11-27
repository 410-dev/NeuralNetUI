import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.NEURAL_CHAT_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "neural-mcp-oauth-test-"));
const { db } = await import("./database.ts");
const oauth = await import("./mcp-oauth.ts");
const { mcpOAuthPreset } = await import("./mcp-oauth-presets.ts");

const stamp = new Date().toISOString();
db.prepare("INSERT INTO users(id, username, password_hash, display_name, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run("u1", "oauth-user", "x", "U", "user", stamp, stamp);
const preset = mcpOAuthPreset("https://gmailmcp.googleapis.com/mcp/v1")!;
const config = { clientId: "cid", clientSecret: "secret", authorizationUrl: preset.authorizationUrl, tokenUrl: preset.tokenUrl, scopes: preset.scopes };
db.prepare("INSERT INTO mcp_connections(id,user_id,name,description,url,auth_type,credential,enabled,tool_timeout_seconds,kind,oauth,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
  .run("m1", "u1", "Gmail", "", "https://gmailmcp.googleapis.com/mcp/v1", "oauth", "", 1, 20, "user", JSON.stringify(config), stamp, stamp);

test("Google presets fill endpoints and per-product scopes", () => {
  assert.equal(preset.tokenUrl, "https://oauth2.googleapis.com/token");
  assert.ok(preset.scopes.includes("https://www.googleapis.com/auth/gmail.modify"));
  assert.ok(mcpOAuthPreset("https://calendarmcp.googleapis.com/mcp/v1")!.scopes.includes("https://www.googleapis.com/auth/calendar.events"));
  assert.equal(mcpOAuthPreset("https://example.com/mcp"), undefined);
});

test("sign-in: PKCE authorization URL, code exchange, renewal before expiry", async () => {
  await assert.rejects(oauth.oauthAccessToken("m1"), /로그인되지 않았습니다/);
  const url = new URL(oauth.startOAuth("u1", "m1", "https://nnui.example/api/mcp-connections/oauth/callback"));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.ok(url.searchParams.get("scope")!.includes("gmail.readonly"));
  const calls: URLSearchParams[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    const body = new URLSearchParams(String(init?.body)); calls.push(body);
    const refresh = body.get("grant_type") === "refresh_token";
    return new Response(JSON.stringify({ access_token: refresh ? "access-2" : "access-1", ...(refresh ? {} : { refresh_token: "refresh-1" }), expires_in: 3600 }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    await oauth.finishOAuth(url.searchParams.get("state")!, "the-code");
    assert.equal(calls[0].get("grant_type"), "authorization_code");
    assert.equal(calls[0].get("client_secret"), "secret");
    assert.ok(calls[0].get("code_verifier"));
    await assert.rejects(oauth.finishOAuth(url.searchParams.get("state")!, "again"), /만료/);   // one-time state
    assert.equal(await oauth.oauthAccessToken("m1"), "access-1");
    assert.equal(calls.length, 1);
    // about to expire: renewed once even when asked twice at the same time
    const row = db.prepare("SELECT oauth FROM mcp_connections WHERE id='m1'").get() as { oauth: string };
    db.prepare("UPDATE mcp_connections SET oauth=? WHERE id='m1'").run(JSON.stringify({ ...JSON.parse(row.oauth), expiresAt: Date.now() + 10_000 }));
    const [a, b] = await Promise.all([oauth.oauthAccessToken("m1"), oauth.oauthAccessToken("m1")]);
    assert.equal(a, "access-2"); assert.equal(b, "access-2");
    assert.equal(calls.filter(call => call.get("grant_type") === "refresh_token").length, 1);
    assert.equal(calls.at(-1)!.get("refresh_token"), "refresh-1");
    const saved = JSON.parse((db.prepare("SELECT oauth FROM mcp_connections WHERE id='m1'").get() as { oauth: string }).oauth);
    assert.equal(saved.refreshToken, "refresh-1");   // kept when the renewal returns none
  } finally { globalThis.fetch = realFetch; }
});
