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

test("the cache lifetime is read from a routing session's current provider only", () => {
  const session = { object: "lmf.session", route: { current: { provider: "claude", model: "opus", cachettl_minutes: 60, seconds_since_last_request: 600, cache_ttl_remaining_seconds: 3000 } } };
  assert.deepEqual(lmf.cacheFrom(session), { remainingSeconds: 3000, totalSeconds: 3600, entry: { provider: "claude", model: "opus", effort: undefined, template: undefined, position: undefined } });
  assert.equal(lmf.cacheFrom({ object: "lmf.session", route: { current: null } }), undefined);
  assert.equal(lmf.cacheFrom({ object: "lmf.session", next: { account: "claude" } }), undefined);
  assert.equal(lmf.cacheFrom({ object: "lmf.route", providers: [] }), undefined);
  assert.equal(lmf.cacheFrom({ route: { current: { provider: "c", cache_ttl_remaining_seconds: -4 } } })?.remainingSeconds, 0);
});

test("quota targets: provider windows in routing order, none for a provider without quota", () => {
  const payload = { object: "lmf.route", providers: [
    { provider: "claude-be", model: "sonnet", effort: "medium", position: 1, available: true, windows: [
      { name: "five_hour", source: "provider", used: 0.11, threshold: 0.75, window_seconds: 18000, resets_at: "2026-11-27T00:40:00+00:00", observed_at: 1795733851 },
      { name: "seven_day", source: "provider", used: 0.59, threshold: 0.7, window_seconds: 604800 }] },
    { provider: "gemini", model: "gemini-4-hydrogen-high", position: 2, available: true, windows: [] },
    { provider: "codex", model: "gpt-6.2-sol", position: 3, available: false, windows: [{ name: "primary", used: "bad" }] }] };
  const targets = lmf.quotaTargets(payload, { routeDisplayNames: { "claude-be/sonnet": "Claude Sonnet" } });
  assert.deepEqual(targets.map(item => item.label), ["Claude Sonnet", "gemini · gemini-4-hydrogen-high", "codex · gpt-6.2-sol"]);
  assert.deepEqual(targets[0].windows.map(item => [item.windowSeconds, item.usedPercent, item.thresholdPercent]), [[18000, 11, 75], [604800, 59, 70]]);
  assert.equal(targets[0].windows[0].observedAt, new Date(1795733851000).toISOString());
  assert.equal(targets[1].windows.length, 0);
  assert.equal(targets[2].available, false);
  assert.equal(targets[2].windows.length, 0);
});

test("antigravity quota targets share keys with the route targets they fill in", () => {
  const route = lmf.quotaTargets({ providers: [{ provider: "gemini", model: "gemini-4-hydrogen-high", position: 2, windows: [] }] }, {});
  const agy = lmf.agyQuotaTargets({ object: "lmf.route.agy_quota", targets: [
    { provider: "gemini", model: "gemini-4-hydrogen-high", position: 2, group: "Gemini Models", windows: [
      { name: "weekly", label: "Weekly", source: "provider", used: 0.0733, threshold: 0.7, window_seconds: 604800, resets_at: "2026-12-03T15:04:35+00:00", observed_at: 1795867656 },
      { name: "five_hour", source: "provider", used: 0.0194, threshold: 0.75, window_seconds: 18000 }] },
    { provider: "gemini2", position: 4, windows: [], error: "could not read the Antigravity quota: not signed in" }] });
  assert.equal(agy[0].key, route[0].key);
  assert.equal(agy[0].group, "Gemini Models");
  assert.deepEqual(agy[0].windows.map(item => [item.name, item.windowSeconds, item.usedPercent, item.thresholdPercent]), [["weekly", 604800, 7.3, 70], ["five_hour", 18000, 1.9, 75]]);
  assert.match(agy[1].error || "", /not signed in/);
  assert.deepEqual(lmf.agyQuotaTargets({ error: "x" }), []);
});
