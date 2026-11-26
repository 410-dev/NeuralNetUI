import { randomUUID } from "node:crypto";
import { db } from "./database.ts";

/** How long one stated reason keeps a user's records open to the auditor who gave it. */
export const AUDIT_UNLOCK_MINUTES = 60;
export const AUDIT_REASON_MAX_LENGTH = 1000;

export type AuditUnlock = { id: string; reason: string; createdAt: string; expiresAt: string };
export type AuditNotice = { id: string; reason: string; createdAt: string };
type Row = { id: string; reason: string; created_at: string; expires_at: string };
const unlock = (row: Row): AuditUnlock => ({ id: row.id, reason: row.reason, createdAt: row.created_at, expiresAt: row.expires_at });

export function activeAuditUnlock(actorUserId: string, targetUserId: string, now = new Date()): AuditUnlock | undefined {
  const row = db.prepare("SELECT id, reason, created_at, expires_at FROM audit_unlocks WHERE actor_user_id = ? AND target_user_id = ? AND expires_at > ? ORDER BY expires_at DESC LIMIT 1")
    .get(actorUserId, targetUserId, now.toISOString()) as Row | undefined;
  return row ? unlock(row) : undefined;
}

/** Opens a user's records to one auditor for a limited time and queues a notice the user sees on their next visit. */
export function createAuditUnlock(actorUserId: string, targetUserId: string, reason: string, now = new Date()): AuditUnlock {
  const text = reason.trim().slice(0, AUDIT_REASON_MAX_LENGTH);
  if (!text) throw Object.assign(new Error("An audit reason is required."), { status: 400 });
  const row: Row = { id: randomUUID(), reason: text, created_at: now.toISOString(), expires_at: new Date(now.getTime() + AUDIT_UNLOCK_MINUTES * 60_000).toISOString() };
  db.prepare("INSERT INTO audit_unlocks(id, actor_user_id, target_user_id, reason, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(row.id, actorUserId, targetUserId, row.reason, row.created_at, row.expires_at);
  // Same record logAdminAudit writes; kept local so this module does not pull in the session layer.
  db.prepare("INSERT INTO admin_audit_log(actor_user_id, target_user_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(actorUserId, targetUserId, "user.audit.unlock", JSON.stringify({ unlockId: row.id, reason: row.reason, expiresAt: row.expires_at }), row.created_at);
  return unlock(row);
}

export function pendingAuditNotices(userId: string): AuditNotice[] {
  return (db.prepare("SELECT id, reason, created_at, expires_at FROM audit_unlocks WHERE target_user_id = ? AND acknowledged_at IS NULL ORDER BY created_at ASC, rowid ASC LIMIT 50").all(userId) as Row[])
    .map(row => ({ id: row.id, reason: row.reason, createdAt: row.created_at }));
}

export function acknowledgeAuditNotices(userId: string, ids: string[], now = new Date()) {
  const statement = db.prepare("UPDATE audit_unlocks SET acknowledged_at = ? WHERE id = ? AND target_user_id = ? AND acknowledged_at IS NULL");
  db.transaction(() => { for (const id of ids.slice(0, 50)) statement.run(now.toISOString(), String(id), userId); })();
}
