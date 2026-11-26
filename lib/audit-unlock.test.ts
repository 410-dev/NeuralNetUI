import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.NEURAL_CHAT_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "neural-audit-unlock-test-"));
const { db } = await import("./database.ts");
const { activeAuditUnlock, createAuditUnlock, pendingAuditNotices, acknowledgeAuditNotices, AUDIT_UNLOCK_MINUTES } = await import("./audit-unlock.ts");

function user(role: string) {
  const id = crypto.randomUUID(), stamp = new Date().toISOString();
  db.prepare("INSERT INTO users(id,username,display_name,password_hash,role,preferences,created_at,updated_at) VALUES(?,?,?,?,?,'{}',?,?)").run(id, `u-${id}`, "U", "unused", role, stamp, stamp);
  return id;
}

test("an unlock is scoped to one auditor and target, expires, and is logged", () => {
  const admin = user("admin"), other = user("admin"), target = user("user"), now = new Date("2026-11-26T00:00:00Z");
  assert.equal(activeAuditUnlock(admin, target, now), undefined);
  assert.throws(() => createAuditUnlock(admin, target, "   ", now), /reason/);
  const unlock = createAuditUnlock(admin, target, "  reported conversation  ", now);
  assert.equal(unlock.reason, "reported conversation");
  assert.equal(activeAuditUnlock(admin, target, now)?.id, unlock.id);
  assert.equal(activeAuditUnlock(other, target, now), undefined);
  assert.equal(activeAuditUnlock(admin, target, new Date(now.getTime() + AUDIT_UNLOCK_MINUTES * 60_000)), undefined);
  const log = db.prepare("SELECT detail FROM admin_audit_log WHERE target_user_id = ? AND action = 'user.audit.unlock'").get(target) as { detail: string };
  assert.equal(JSON.parse(log.detail).reason, "reported conversation");
});

test("the audited user sees each reason once, and only their own", () => {
  const admin = user("admin"), target = user("user"), bystander = user("user");
  createAuditUnlock(admin, target, "first");
  createAuditUnlock(admin, target, "second");
  const notices = pendingAuditNotices(target);
  assert.deepEqual(notices.map(notice => notice.reason), ["first", "second"]);
  assert.deepEqual(pendingAuditNotices(bystander), []);
  acknowledgeAuditNotices(bystander, notices.map(notice => notice.id));
  assert.equal(pendingAuditNotices(target).length, 2);
  acknowledgeAuditNotices(target, notices.map(notice => notice.id));
  assert.deepEqual(pendingAuditNotices(target), []);
});
