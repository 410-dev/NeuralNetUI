import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.NEURAL_CHAT_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "neural-agent-test-"));
const { db } = await import("../database.ts");
const policy = await import("./policy.ts");
const store = await import("./store.ts");

const user = () => { const id = crypto.randomUUID(), stamp = new Date().toISOString(); db.prepare("INSERT INTO users(id,username,display_name,password_hash,role,preferences,created_at,updated_at) VALUES(?,?,?,?,?,'{}',?,?)").run(id, `u-${id}`, "U", "x", "user", stamp, stamp); return id; };

test("automatic runs allow reads and ask before writes unless the person decided otherwise", () => {
  assert.equal(policy.isReadOnlyCall("web-search", "internet_search", {}), true);
  assert.equal(policy.isReadOnlyCall("youtube", "download_youtube_video", {}), false);
  assert.equal(policy.isReadOnlyCall("storage", "storage_access", { action: "read" }), true);
  assert.equal(policy.isReadOnlyCall("storage", "storage_access", { action: "write" }), false);
  assert.equal(policy.isReadOnlyCall("browser", "browser_click", {}), false);
  assert.equal(policy.isReadOnlyCall("browser", "browser_snapshot", {}), true);
  assert.equal(policy.isReadOnlyCall("mcp:mail", "list_messages", {}, true), true);
  assert.equal(policy.isReadOnlyCall("mcp:mail", "send_message", {}), false);
  assert.equal(policy.decideAgentCall({}, "mcp:mail", "list_messages", true), "allow");
  assert.equal(policy.decideAgentCall({}, "mcp:mail", "send_message", false), "ask");
  const rules = { "mcp:mail": { read: "ask" as const, write: "allow" as const, tools: { send_message: "ask" as const } } };
  assert.equal(policy.decideAgentCall(rules, "mcp:mail", "list_messages", true), "ask");
  assert.equal(policy.decideAgentCall(rules, "mcp:mail", "archive", false), "allow");
  assert.equal(policy.decideAgentCall(rules, "mcp:mail", "send_message", false), "ask");
  assert.equal(policy.decideAgentCall(rules, policy.AGENT_PROVIDER_ID, "workboard_add", false), "allow");
});

test("wakeups fire once; recurring work moves to its next slot and respects the plan's minimum interval", () => {
  const id = user(), at = Date.parse("2026-11-26T00:00:00Z");
  const once = store.addAgentSchedule(id, { title: "물", instructions: "물 주기", inMinutes: 300 }, 30, at);
  assert.equal(once.kind, "once"); assert.equal(once.nextRunAt, "2026-11-26T05:00:00.000Z");
  assert.throws(() => store.addAgentSchedule(id, { title: "메일", instructions: "확인", everyMinutes: 10 }, 30, at), /at least 30/);
  const recurring = store.addAgentSchedule(id, { title: "메일", instructions: "확인", everyMinutes: 60 }, 30, at);
  assert.equal(recurring.nextRunAt, "2026-11-26T01:00:00.000Z");
  assert.deepEqual(store.dueAgentSchedules(new Date(at + 5 * 3600_000)).map(item => item.id).sort(), [once.id, recurring.id].sort());
  store.advanceAgentSchedule(once.id, at + 5 * 3600_000); store.advanceAgentSchedule(recurring.id, at + 5.5 * 3600_000);
  assert.equal(store.getAgentSchedule(id, once.id)?.enabled, false);
  assert.equal(store.getAgentSchedule(id, recurring.id)?.nextRunAt, "2026-11-26T06:00:00.000Z");
});

test("workboard items and settings are validated", () => {
  const id = user();
  assert.throws(() => store.addAgentItem(id, { kind: "note" as never, title: "x" }), /kind/);
  const event = store.addAgentItem(id, { kind: "event", title: "회의", startsAt: "2026-11-27T10:00:00+09:00" });
  assert.equal(event.startsAt, "2026-11-27T01:00:00.000Z");
  assert.equal(store.updateAgentItem(id, event.id, { startsAt: null }).startsAt, undefined);
  assert.equal(store.addAgentItem(id, { kind: "todo", title: "할 일" }).status, "open");
  const settings = store.normalizeAgentSettings({ heartbeatMinutes: 0, compactPercent: 500, toolRules: { "mcp:x": { read: "nope", write: "allow", tools: { a: "ask", b: "deny" } } } });
  assert.equal(settings.heartbeatMinutes, 1); assert.equal(settings.compactPercent, 95);
  assert.deepEqual(settings.toolRules, { "mcp:x": { write: "allow", tools: { a: "ask" } } });
});
