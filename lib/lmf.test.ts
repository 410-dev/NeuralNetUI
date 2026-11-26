import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.NEURAL_CHAT_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "neural-lmf-test-"));
const lmf = await import("./lmf.ts");
const { defaultModelWeights, effectiveModelWeights, weightedTokenUsage } = await import("./plan-usage.ts");

test("route payloads resolve where the next request goes and what the last one used", () => {
  const route = { object: "lmf.route", providers: [{ provider: "claude", model: "opus", effort: "high", position: 1 }, { provider: "claude", model: "opus", effort: "low", position: 2 }, { provider: "codex", template: "default", position: 3 }], next_one_shot: { strategy: "rotate-per-request", next: { provider: "codex", template: "default", position: 3 }, skipped: [] } };
  assert.deepEqual(lmf.routeEntries(route).map(lmf.lmfRouteKey), ["claude/opus", "codex/default"]);
  assert.equal(lmf.routingFrom(route, "next")?.provider, "codex");
  const session = { object: "lmf.session", route: { current: { provider: "claude", model: "opus", position: 1 }, strategy: "cache-continuum-rotation", next: { provider: "gemini", model: "pro", position: 2 }, skipped: [] }, last: { provider: "claude", model: "claude-opus-4" } };
  assert.equal(lmf.routingFrom(session, "next")?.provider, "gemini");
  assert.equal(lmf.routingFrom(session, "current")?.provider, "claude");
  assert.equal(lmf.routingFrom({ object: "lmf.session", last: { provider: "codex", model: "gpt-5" } }, "current")?.model, "gpt-5");
  assert.equal(lmf.routingFrom({ object: "lmf.route", next_one_shot: { next: null } }, "next"), undefined);
});

test("display names come from the model settings, else the provider and model", () => {
  const model = { routeDisplayNames: { "claude/opus": "Claude Opus" } };
  assert.equal(lmf.lmfRouteLabel(model, { provider: "claude", model: "opus", effort: "low" }), "Claude Opus");
  assert.equal(lmf.lmfRouteLabel(model, { provider: "codex", template: "default" }), "codex · default");
});

test("session ids are read from headers or the first chunk and stored per chat, connection and model", () => {
  assert.equal(lmf.lmfSessionFrom(new Headers({ "X-LMF-Session": "abc" })), "abc");
  assert.equal(lmf.lmfSessionFrom(undefined, { lmf: { session: "def" } }), "def");
  assert.equal(lmf.lmfSessionFrom(new Headers(), { choices: [] }), undefined);
  lmf.saveLmfSession("chat", "conn", "auto", "s1");
  lmf.saveLmfSession("chat", "conn", "auto", "s2");
  assert.equal(lmf.storedLmfSession("chat", "conn", "auto"), "s2");
  assert.equal(lmf.storedLmfSession("chat", "conn", "claude"), undefined);
  lmf.forgetLmfSession("chat", "conn", "auto");
  assert.equal(lmf.storedLmfSession("chat", "conn", "auto"), undefined);
  assert.equal(lmf.isLmfSessionGone(404, '{"error":{"code":"session_not_found"}}'), true);
  assert.equal(lmf.isLmfSessionGone(429, "rate limited"), false);
  assert.equal(lmf.lmfEndpoint("http://h:8700/v1/", "sessions/x"), "http://h:8700/v1/lmf/sessions/x");
});

test("cached prompt tokens are discounted only while the connection allows it", () => {
  assert.equal(lmf.lmfChargedInput({}, 1000, 800), 280);
  assert.equal(lmf.lmfChargedInput({ lmfCacheDiscountPercent: 50 }, 1000, 800), 600);
  assert.equal(lmf.lmfChargedInput({ lmfCacheDiscount: false }, 1000, 800), 1000);
  assert.equal(lmf.lmfChargedInput({}, 1000, 5000), 100);
  assert.equal(lmf.lmfChargedInput({}, 1000), 1000);
});

test("a plan weight overrides the model default weight, which overrides 1", () => {
  const defaults = defaultModelWeights([{ id: "a", usageWeight: 2 }, { id: "b" }, { id: "alias", isAlias: true, usageWeight: 9 }, { id: "c", usageWeight: 1 }]);
  assert.deepEqual(defaults, { a: 2 });
  const weights = effectiveModelWeights({ b: 3 }, defaults);
  assert.equal(weightedTokenUsage([{ modelId: "a", inputTokens: 10, outputTokens: 0 }, { modelId: "b", inputTokens: 10, outputTokens: 0 }, { modelId: "z", inputTokens: 10, outputTokens: 0 }], "input", weights), 60);
  assert.equal(effectiveModelWeights({ a: 1.5 }, defaults).a, 1.5);
});

test("sessions expire after the connection TTL, and deleted chats' sessions are swept", async () => {
  const { db } = await import("./database.ts");
  const stamp = new Date().toISOString();
  const user = crypto.randomUUID();
  db.prepare("INSERT INTO users(id,username,display_name,password_hash,role,preferences,created_at,updated_at) VALUES(?,?,?,?,?,'{}',?,?)").run(user, `u-${user}`, "U", "x", "user", stamp, stamp);
  const conversation = (id: string, deleted?: string) => {
    db.pragma("foreign_keys = OFF");
    db.prepare("INSERT INTO conversations(id,title,model_id,active_branch_id,created_at,updated_at,user_id,deleted_at) VALUES(?,?,?,?,?,?,?,?)").run(id, "t", "auto", `b-${id}`, stamp, stamp, user, deleted ?? null);
    db.pragma("foreign_keys = ON");
  };
  conversation("live"); conversation("trashed", stamp);
  const now = Date.parse("2026-11-26T12:00:00Z"), hours = (n: number) => new Date(now - n * 3600_000).toISOString();
  const put = (conv: string, connection: string, sid: string, at: string) => db.prepare("INSERT OR REPLACE INTO lmf_sessions(conversation_id,connection_id,model,session_id,updated_at) VALUES(?,?,?,?,?)").run(conv, connection, "auto", sid, at);
  put("live", "lmf", "fresh", hours(2)); put("live", "lmf-short", "idle", hours(3)); put("trashed", "lmf", "trashed", hours(1)); put("missing", "lmf", "orphan", hours(1)); put("live", "removed", "unknown-connection", hours(1));
  const connections = [{ id: "lmf", driver: "lmf" as const }, { id: "lmf-short", driver: "lmf" as const, lmfSessionTtlHours: 2 }];
  assert.deepEqual(lmf.staleLmfSessions(connections, now).map(row => row.sessionId).sort(), ["idle", "orphan", "trashed", "unknown-connection"]);
  assert.equal(lmf.storedLmfSession("live", "lmf-short", "auto", lmf.lmfSessionTtlMs(connections[1]), now), undefined);
  assert.equal(lmf.storedLmfSession("live", "lmf", "auto", lmf.lmfSessionTtlMs(connections[0]), now), "fresh");
  // A row replaced by a newer session is not removed by a sweep that read the old one.
  lmf.dropLmfSessionRow({ conversationId: "live", connectionId: "lmf", model: "auto", sessionId: "other" });
  assert.equal(lmf.storedLmfSession("live", "lmf", "auto"), "fresh");
  const calls: string[] = [];
  const request = (async (url: string, init: RequestInit) => { calls.push(`${init.method} ${url}`); return new Response("", { status: url.includes("gone") ? 404 : url.includes("down") ? 503 : 200 }); }) as typeof fetch;
  assert.equal(await lmf.deleteRemoteLmfSession({ baseUrl: "http://h/v1" }, {}, "s 1", request), true);
  assert.equal(await lmf.deleteRemoteLmfSession({ baseUrl: "http://h/v1" }, {}, "gone", request), true);
  assert.equal(await lmf.deleteRemoteLmfSession({ baseUrl: "http://h/v1" }, {}, "down", request), false);
  assert.equal(calls[0], "DELETE http://h/v1/lmf/sessions/s%201?purge=1");
});
