import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { db } from "./database";
import { discardChatJobs } from "./chat-disposal";
import { deleteUploadFiles } from "./uploads";
import type { AccountInfo, UserRole, UserSummary } from "./types";
import { resolvedQuota } from "./quota-defaults";

const scrypt = promisify(scryptCallback);
const COOKIE_NAME = "neural_chat_session";
const SESSION_DAYS = 30;

type UserRow = {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  role: UserRole;
  preferences: string;
  storage_quota_bytes: number;
  trash_quota_bytes: number;
  storage_quota_uses_default: number;
  trash_quota_uses_default: number;
  audit_enabled: number;
  plan_id: string | null;
  created_at: string;
};

export type AuthUser = AccountInfo & { preferences: Record<string, unknown> };

export class AuthError extends Error {
  constructor(message = "Authentication required.", public status = 401) { super(message); }
}

function accountFrom(row: UserRow): AuthUser {
  let preferences: Record<string, unknown> = {};
  try { preferences = JSON.parse(row.preferences || "{}"); } catch { /* use defaults */ }
  return { id: row.id, username: row.username, displayName: row.display_name, role: row.role, canAudit: row.role === "superadmin" || row.role === "admin" && row.audit_enabled === 1, preferences, ...(row.plan_id ? { planId: row.plan_id } : {}) };
}

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return "";
}

function tokenHash(token: string) { return createHash("sha256").update(token).digest("hex"); }

export async function hashPassword(password: string) {
  if (password.length < 8 || password.length > 200) throw new AuthError("비밀번호는 8자 이상이어야 합니다.", 400);
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [kind, salt, expectedHex] = encoded.split("$");
  if (kind !== "scrypt" || !salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = await scrypt(password, salt, expected.length) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function setupRequired() {
  return !(db.prepare("SELECT 1 FROM users LIMIT 1").get());
}

export function getUser(request: Request): AuthUser | null {
  const token = cookieValue(request, COOKIE_NAME);
  if (!token) return null;
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString());
  const row = db.prepare(`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(tokenHash(token), new Date().toISOString()) as UserRow | undefined;
  return row ? accountFrom(row) : null;
}

export function requireUser(request: Request) {
  const user = getUser(request);
  if (!user) throw new AuthError();
  return user;
}

export function requireAdmin(request: Request) {
  const user = requireUser(request);
  if (user.role !== "admin" && user.role !== "superadmin") throw new AuthError("Administrator access required.", 403);
  return user;
}

export function requireAuditor(request: Request) {
  const user = requireAdmin(request);
  if (!user.canAudit) throw new AuthError("Audit permission required.", 403);
  return user;
}

export function authErrorResponse(error: unknown) {
  if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
  const status=(error as {name?:unknown})?.name==="ZodError"?400:typeof (error as {status?:unknown})?.status==="number"?Math.max(400,Math.min(599,Number((error as {status:number}).status))):500;
  const message=(error as {name?:unknown;issues?:Array<{message?:string}>})?.name==="ZodError"?(error as {issues?:Array<{message?:string}>}).issues?.[0]?.message:error instanceof Error?error.message:"요청을 처리하지 못했습니다.";
  return Response.json({ error: message||"입력값을 확인해 주세요." }, { status });
}

export function createSession(userId: string, request: Request) {
  const token = randomBytes(32).toString("base64url");
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SESSION_DAYS * 86400_000);
  db.prepare("INSERT INTO sessions(id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(randomUUID(), userId, tokenHash(token), expiresAt.toISOString(), createdAt.toISOString());
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}

export function clearSession(request: Request) {
  const token = cookieValue(request, COOKIE_NAME);
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

export async function createFirstUser(
  input: { username?: string; displayName?: string; password?: string },
  defaults = { storage: 512 * 1024 ** 2, trash: 1024 * 1024 ** 2 },
) {
  if (!setupRequired()) throw new AuthError("Initial setup is already complete.", 409);
  const username = String(input.username || "").trim();
  const displayName = String(input.displayName || username).trim();
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) throw new AuthError("사용자 이름은 영문, 숫자, ., _, -로 3~40자여야 합니다.", 400);
  if (!displayName || displayName.length > 80) throw new AuthError("표시 이름을 확인해 주세요.", 400);
  const passwordHash = await hashPassword(String(input.password || ""));
  const id = randomUUID(); const stamp = new Date().toISOString();
  const defaultPlan=(db.prepare("SELECT id,storage_quota_bytes AS storage FROM plans ORDER BY created_at LIMIT 1").get() as {id:string;storage:number}|undefined);
  db.transaction(() => {
    if (!setupRequired()) throw new AuthError("Initial setup is already complete.", 409);
    db.prepare("INSERT INTO users(id, username, display_name, password_hash, role, preferences, storage_quota_bytes, trash_quota_bytes, storage_quota_uses_default, trash_quota_uses_default, plan_id, created_at, updated_at) VALUES (?, ?, ?, ?, 'superadmin', '{}', ?, ?, 0, 1, ?, ?, ?)")
      .run(id, username, displayName, passwordHash, defaultPlan?.storage||defaults.storage, defaults.trash,defaultPlan?.id||null, stamp, stamp);
    db.prepare("UPDATE conversations SET user_id = ? WHERE user_id IS NULL").run(id);
    db.prepare("UPDATE uploads SET user_id = ? WHERE user_id IS NULL").run(id);
    const storedConfig = db.prepare("SELECT value FROM app_config WHERE id = 1").get() as { value: string } | undefined;
    if (storedConfig) {
      try {
        type StoredModel = { isAlias?: boolean; ownerId?: string; isPublic?: boolean; reasoningPresets?: Array<{ kind?: string; ownerId?: string }> };
        const config = JSON.parse(storedConfig.value) as { models?: StoredModel[]; connections?: Array<{ models?: StoredModel[] }> };
        for (const model of [...(config.models || []), ...(config.connections || []).flatMap((connection) => connection.models || [])]) {
          if (model.isAlias && !model.ownerId) { model.ownerId = id; model.isPublic = false; }
          for (const preset of model.reasoningPresets || []) if (preset.kind === "custom" && !preset.ownerId) preset.ownerId = id;
        }
        db.prepare("UPDATE app_config SET value = ?, updated_at = ? WHERE id = 1").run(JSON.stringify(config), stamp);
      } catch { /* invalid config is recovered by the config module */ }
    }
  })();
  return id;
}

export async function authenticate(username: string, password: string) {
  const row = db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(username.trim()) as UserRow | undefined;
  if (!row || !(await verifyPassword(password, row.password_hash))) throw new AuthError("사용자 이름 또는 비밀번호가 올바르지 않습니다.", 401);
  return accountFrom(row);
}

export function listUsers(): UserSummary[] {
  return (db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.created_at, u.storage_quota_bytes, u.trash_quota_bytes, u.audit_enabled, u.storage_quota_uses_default, u.trash_quota_uses_default, u.plan_id,
           COALESCE(SUM(CASE WHEN up.deleted_at IS NULL THEN up.size ELSE 0 END), 0) AS storage_used_bytes,
           COALESCE(SUM(CASE WHEN up.deleted_at IS NOT NULL THEN up.size ELSE 0 END), 0) AS trash_used_bytes
    FROM users u LEFT JOIN uploads up ON up.user_id = u.id
    GROUP BY u.id ORDER BY u.created_at
  `).all() as Array<Pick<UserRow, "id" | "username" | "display_name" | "role" | "created_at" | "storage_quota_bytes" | "trash_quota_bytes" | "audit_enabled" | "storage_quota_uses_default" | "trash_quota_uses_default" | "plan_id"> & { storage_used_bytes: number; trash_used_bytes: number }>)
    .map((row) => ({ id: row.id, username: row.username, displayName: row.display_name, role: row.role, canAudit: row.role === "superadmin" || row.role === "admin" && row.audit_enabled === 1, auditEnabled: row.audit_enabled === 1, createdAt: row.created_at, storageQuotaBytes: row.storage_quota_bytes, storageUsedBytes: row.storage_used_bytes, trashQuotaBytes: row.trash_quota_bytes, trashUsedBytes: row.trash_used_bytes, storageQuotaUsesDefault:row.storage_quota_uses_default===1, trashQuotaUsesDefault:row.trash_quota_uses_default===1, ...(row.plan_id ? { planId: row.plan_id } : {}) }));
}

export async function createUser(input: { username?: string; displayName?: string; password?: string; role?: string }, defaults = {storage:512*1024**2,trash:1024*1024**2}) {
  const username = String(input.username || "").trim(); const displayName = String(input.displayName || username).trim();
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) throw new AuthError("사용자 이름은 영문, 숫자, ., _, -로 3~40자여야 합니다.", 400);
  if (!displayName || displayName.length > 80) throw new AuthError("표시 이름을 확인해 주세요.", 400);
  const role: UserRole = input.role === "admin" ? "admin" : "user";
  const passwordHash = await hashPassword(String(input.password || "")); const stamp = new Date().toISOString();
  const defaultPlan=(db.prepare("SELECT id,storage_quota_bytes AS storage FROM plans ORDER BY created_at LIMIT 1").get() as {id:string;storage:number}|undefined);
  try {
    db.prepare("INSERT INTO users(id, username, display_name, password_hash, role, preferences, storage_quota_bytes, trash_quota_bytes, storage_quota_uses_default, trash_quota_uses_default, audit_enabled, plan_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '{}', ?, ?, 0, 1, 0, ?, ?, ?)")
      .run(randomUUID(), username, displayName, passwordHash, role, defaultPlan?.storage||defaults.storage, defaults.trash,defaultPlan?.id||null, stamp, stamp);
  } catch (error) {
    if (String(error).includes("UNIQUE")) throw new AuthError("이미 사용 중인 사용자 이름입니다.", 409);
    throw error;
  }
}

export function updateManagedUser(actor: AuthUser, userId: string, input: { displayName?: string; role?: string; storageQuotaBytes?: number; trashQuotaBytes?: number; auditEnabled?: boolean; planId?: string }, defaults:{storage:number;trash:number}) {
  if (actor.id === userId && (input.displayName !== undefined || input.role !== undefined)) throw new AuthError("현재 로그인한 계정의 이름이나 권한은 여기에서 변경할 수 없습니다.", 409);
  const target = db.prepare("SELECT display_name, role, storage_quota_bytes, trash_quota_bytes, storage_quota_uses_default, trash_quota_uses_default, audit_enabled, plan_id FROM users WHERE id = ?").get(userId) as { display_name: string; role: UserRole; storage_quota_bytes: number; trash_quota_bytes:number; storage_quota_uses_default:number; trash_quota_uses_default:number; audit_enabled:number; plan_id:string|null } | undefined;
  if (!target) throw new AuthError("사용자를 찾을 수 없습니다.", 404);
  const displayName = input.displayName === undefined ? target.display_name : String(input.displayName).trim();
  if (!displayName || displayName.length > 80) throw new AuthError("표시 이름을 확인해 주세요.", 400);
  if (input.role !== undefined && input.role !== "admin" && input.role !== "user" && input.role !== "superadmin") {
    throw new AuthError("사용자 권한을 확인해 주세요.", 400);
  }
  const role = input.role === undefined ? target.role : input.role as UserRole;
  if (target.role === "superadmin" && role !== "superadmin") throw new AuthError("최고 관리자의 권한은 변경할 수 없습니다.", 409);
  if (target.role !== "superadmin" && role === "superadmin") throw new AuthError("최고 관리자 권한은 부여할 수 없습니다.", 409);
  const storage=resolvedQuota(input.storageQuotaBytes===undefined?undefined:Number(input.storageQuotaBytes),{bytes:target.storage_quota_bytes,usesDefault:target.storage_quota_uses_default===1},defaults.storage);
  const storageUsesDefault=storage.usesDefault;const quota=storage.bytes;
  if (!Number.isSafeInteger(quota) || quota < 1024 * 1024 || quota > 10 * 1024 ** 4) throw new AuthError("저장소 할당량은 1MB~10TB 사이여야 합니다.", 400);
  const trash=resolvedQuota(input.trashQuotaBytes===undefined?undefined:Number(input.trashQuotaBytes),{bytes:target.trash_quota_bytes,usesDefault:target.trash_quota_uses_default===1},defaults.trash);
  const trashUsesDefault=trash.usesDefault;const trashQuota=trash.bytes;
  if (!Number.isSafeInteger(trashQuota) || trashQuota < 1024 * 1024 || trashQuota > 20 * 1024 ** 4) throw new AuthError("휴지통 할당량은 1MB~20TB 사이여야 합니다.", 400);
  if (input.auditEnabled !== undefined && actor.role !== "superadmin") throw new AuthError("최고 관리자만 감사 권한을 변경할 수 있습니다.", 403);
  if (actor.role !== "superadmin" && target.audit_enabled === 1 && (input.role !== undefined || input.displayName !== undefined)) throw new AuthError("감사 권한이 있는 관리자는 최고 관리자만 변경할 수 있습니다.", 403);
  const auditEnabled = role === "admin" && (input.auditEnabled === undefined ? target.audit_enabled === 1 : input.auditEnabled === true);
  let planId=input.planId===undefined?target.plan_id:String(input.planId||"");
  if(planId&&!db.prepare("SELECT 1 FROM plans WHERE id=?").get(planId))throw new AuthError("플랜을 찾을 수 없습니다.",404);
  if(!planId)planId=null;
  db.transaction(() => {
    // Serialize the usage check with upload quota reservations so an upload
    // cannot commit between this check and a quota reduction.
    const used = (db.prepare("SELECT COALESCE(SUM(size), 0) AS bytes FROM uploads WHERE user_id = ? AND deleted_at IS NULL").get(userId) as { bytes: number }).bytes;
    if (quota < used) throw new AuthError("현재 사용 중인 용량보다 할당량을 작게 설정할 수 없습니다.", 409);
    let assignedQuota=quota;
    if(input.planId!==undefined&&planId){const plan=db.prepare("SELECT storage_quota_bytes AS bytes FROM plans WHERE id=?").get(planId) as {bytes:number};if(plan.bytes<used)throw new AuthError("플랜 저장소 용량이 현재 사용량보다 작습니다.",409);assignedQuota=plan.bytes;}
    const result = db.prepare("UPDATE users SET display_name = ?, role = ?, storage_quota_bytes = ?, trash_quota_bytes = ?, storage_quota_uses_default=?, trash_quota_uses_default=?, audit_enabled = ?, plan_id=?, updated_at = ? WHERE id = ?")
      .run(displayName, role, assignedQuota, trashQuota,input.planId!==undefined&&planId?0:Number(storageUsesDefault),Number(trashUsesDefault), Number(auditEnabled),planId, new Date().toISOString(), userId);
    if (!result.changes) throw new AuthError("사용자를 찾을 수 없습니다.", 404);
  })();
  logAdminAudit(actor.id, userId, "user.settings.update", JSON.stringify({ role, storageQuotaBytes: quota, trashQuotaBytes: trashQuota,storageUsesDefault,trashUsesDefault,auditEnabled,planId }));
}

export function logAdminAudit(actorUserId: string, targetUserId: string, action: string, detail?: string) {
  db.prepare("INSERT INTO admin_audit_log(actor_user_id, target_user_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(actorUserId, targetUserId, action.slice(0, 120), detail?.slice(0, 4000) || null, new Date().toISOString());
}

export async function deleteManagedUser(actor: AuthUser, userId: string) {
  if (actor.id === userId) throw new AuthError("현재 로그인한 계정은 삭제할 수 없습니다.", 409);
  const target = db.prepare("SELECT role FROM users WHERE id = ?").get(userId) as { role: UserRole } | undefined;
  if (!target) throw new AuthError("사용자를 찾을 수 없습니다.", 404);
  if (target.role === "superadmin") throw new AuthError("최고 관리자 계정은 삭제할 수 없습니다.", 409);

  const uploadIds = (db.prepare("SELECT id FROM uploads WHERE user_id = ?").all(userId) as Array<{ id: string }>).map((row) => row.id);
  db.transaction(() => {
    // Remove conversations first so message attachment references cannot block
    // deletion of the user's upload rows.
    db.prepare("DELETE FROM conversations WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM uploads WHERE user_id = ?").run(userId);

    const stored = db.prepare("SELECT value FROM app_config WHERE id = 1").get() as { value: string } | undefined;
    if (stored) {
      try {
        type StoredModel = { isAlias?: boolean; ownerId?: string; reasoningPresets?: Array<{ ownerId?: string }> };
        const config = JSON.parse(stored.value) as {
          models?: StoredModel[];
          connections?: Array<{ models?: StoredModel[] }>;
        };
        if (Array.isArray(config.models)) {
          config.models = config.models
            .filter((model) => !(model.isAlias && model.ownerId === userId))
            .map((model) => ({
              ...model,
              reasoningPresets: Array.isArray(model.reasoningPresets)
                ? model.reasoningPresets.filter((preset) => preset.ownerId !== userId)
                : model.reasoningPresets,
            }));
        }
        for (const connection of config.connections || []) if (Array.isArray(connection.models)) connection.models = connection.models.map((model) => ({ ...model, reasoningPresets: model.reasoningPresets?.filter((preset) => preset.ownerId !== userId) }));
        db.prepare("UPDATE app_config SET value = ?, updated_at = ? WHERE id = 1")
          .run(JSON.stringify(config), new Date().toISOString());
      } catch { /* invalid config is recovered by the config module */ }
    }

    const deleted = db.prepare("DELETE FROM users WHERE id = ? AND role != 'superadmin'").run(userId);
    if (!deleted.changes) throw new AuthError("최고 관리자 계정은 삭제할 수 없습니다.", 409);
  })();

  discardChatJobs(userId);
  const cleanup = await Promise.allSettled(uploadIds.map((id) => deleteUploadFiles(id)));
  for (const result of cleanup) if (result.status === "rejected") console.error("Unable to remove deleted user's upload files", result.reason);
}

export async function changePassword(user: AuthUser, currentPassword: string, nextPassword: string) {
  const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(user.id) as { password_hash: string } | undefined;
  if (!row || !(await verifyPassword(currentPassword, row.password_hash))) throw new AuthError("현재 비밀번호가 올바르지 않습니다.", 400);
  const passwordHash = await hashPassword(nextPassword);
  db.transaction(() => {
    db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(passwordHash, new Date().toISOString(), user.id);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
  })();
}

/**
 * Writes one preference onto every account. Only the named key is replaced, so a person's
 * language, appearance and the other default they did not have applied to them stay as they were.
 */
export function overwriteUserPreference(key: "defaultModelId" | "defaultReasoningPresetId", value: string) {
  const rows = db.prepare("SELECT id, preferences FROM users").all() as Array<{ id: string; preferences: string }>;
  const update = db.prepare("UPDATE users SET preferences = ?, updated_at = ? WHERE id = ?");
  const stamp = new Date().toISOString();
  db.transaction(() => {
    for (const row of rows) {
      let preferences: Record<string, unknown> = {};
      try { preferences = JSON.parse(row.preferences || "{}"); } catch { /* unreadable preferences start again from this choice */ }
      update.run(JSON.stringify({ ...preferences, [key]: value }), stamp, row.id);
    }
  })();
}

export function updateUserPreferences(userId: string, displayName: string, preferences: Record<string, unknown>) {
  db.prepare("UPDATE users SET display_name = ?, preferences = ?, updated_at = ? WHERE id = ?")
    .run(displayName, JSON.stringify(preferences), new Date().toISOString(), userId);
}
