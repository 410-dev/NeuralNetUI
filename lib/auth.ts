import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { db } from "./database";
import { deleteUploadFiles } from "./uploads";
import type { AccountInfo, UserRole, UserSummary } from "./types";

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
  created_at: string;
};

export type AuthUser = AccountInfo & { preferences: Record<string, unknown> };

export class AuthError extends Error {
  constructor(message = "Authentication required.", public status = 401) { super(message); }
}

function accountFrom(row: UserRow): AuthUser {
  let preferences: Record<string, unknown> = {};
  try { preferences = JSON.parse(row.preferences || "{}"); } catch { /* use defaults */ }
  return { id: row.id, username: row.username, displayName: row.display_name, role: row.role, preferences };
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

export function authErrorResponse(error: unknown) {
  if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
  return Response.json({ error: error instanceof Error ? error.message : "요청을 처리하지 못했습니다." }, { status: 500 });
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

export async function createFirstUser(input: { username?: string; displayName?: string; password?: string }) {
  if (!setupRequired()) throw new AuthError("Initial setup is already complete.", 409);
  const username = String(input.username || "").trim();
  const displayName = String(input.displayName || username).trim();
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) throw new AuthError("사용자 이름은 영문, 숫자, ., _, -로 3~40자여야 합니다.", 400);
  if (!displayName || displayName.length > 80) throw new AuthError("표시 이름을 확인해 주세요.", 400);
  const passwordHash = await hashPassword(String(input.password || ""));
  const id = randomUUID(); const stamp = new Date().toISOString();
  db.transaction(() => {
    if (!setupRequired()) throw new AuthError("Initial setup is already complete.", 409);
    db.prepare("INSERT INTO users(id, username, display_name, password_hash, role, preferences, created_at, updated_at) VALUES (?, ?, ?, ?, 'superadmin', '{}', ?, ?)")
      .run(id, username, displayName, passwordHash, stamp, stamp);
    db.prepare("UPDATE conversations SET user_id = ? WHERE user_id IS NULL").run(id);
    db.prepare("UPDATE uploads SET user_id = ? WHERE user_id IS NULL").run(id);
    const storedConfig = db.prepare("SELECT value FROM app_config WHERE id = 1").get() as { value: string } | undefined;
    if (storedConfig) {
      try {
        const config = JSON.parse(storedConfig.value) as { models?: Array<{ isAlias?: boolean; ownerId?: string; isPublic?: boolean; reasoningPresets?: Array<{ kind?: string; ownerId?: string }> }> };
        for (const model of config.models || []) {
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
  return (db.prepare("SELECT id, username, display_name, role, created_at FROM users ORDER BY created_at").all() as Array<Omit<UserRow, "password_hash" | "preferences" | "updated_at">>)
    .map((row) => ({ id: row.id, username: row.username, displayName: row.display_name, role: row.role, createdAt: row.created_at }));
}

export async function createUser(input: { username?: string; displayName?: string; password?: string; role?: string }) {
  const username = String(input.username || "").trim(); const displayName = String(input.displayName || username).trim();
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) throw new AuthError("사용자 이름은 영문, 숫자, ., _, -로 3~40자여야 합니다.", 400);
  if (!displayName || displayName.length > 80) throw new AuthError("표시 이름을 확인해 주세요.", 400);
  const role: UserRole = input.role === "admin" ? "admin" : "user";
  const passwordHash = await hashPassword(String(input.password || "")); const stamp = new Date().toISOString();
  try {
    db.prepare("INSERT INTO users(id, username, display_name, password_hash, role, preferences, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '{}', ?, ?)")
      .run(randomUUID(), username, displayName, passwordHash, role, stamp, stamp);
  } catch (error) {
    if (String(error).includes("UNIQUE")) throw new AuthError("이미 사용 중인 사용자 이름입니다.", 409);
    throw error;
  }
}

export function updateManagedUser(actor: AuthUser, userId: string, input: { displayName?: string; role?: string }) {
  if (actor.id === userId) throw new AuthError("현재 로그인한 계정은 여기에서 변경할 수 없습니다.", 409);
  const target = db.prepare("SELECT display_name, role FROM users WHERE id = ?").get(userId) as { display_name: string; role: UserRole } | undefined;
  if (!target) throw new AuthError("사용자를 찾을 수 없습니다.", 404);
  const displayName = input.displayName === undefined ? target.display_name : String(input.displayName).trim();
  if (!displayName || displayName.length > 80) throw new AuthError("표시 이름을 확인해 주세요.", 400);
  if (input.role !== undefined && input.role !== "admin" && input.role !== "user" && input.role !== "superadmin") {
    throw new AuthError("사용자 권한을 확인해 주세요.", 400);
  }
  const role = input.role === undefined ? target.role : input.role as UserRole;
  if (target.role === "superadmin" && role !== "superadmin") throw new AuthError("최고 관리자의 권한은 변경할 수 없습니다.", 409);
  if (target.role !== "superadmin" && role === "superadmin") throw new AuthError("최고 관리자 권한은 부여할 수 없습니다.", 409);
  const result = db.prepare("UPDATE users SET display_name = ?, role = ?, updated_at = ? WHERE id = ?")
    .run(displayName, role, new Date().toISOString(), userId);
  if (!result.changes) throw new AuthError("사용자를 찾을 수 없습니다.", 404);
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
        const config = JSON.parse(stored.value) as {
          models?: Array<{
            isAlias?: boolean;
            ownerId?: string;
            reasoningPresets?: Array<{ ownerId?: string }>;
          }>;
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
          db.prepare("UPDATE app_config SET value = ?, updated_at = ? WHERE id = 1")
            .run(JSON.stringify(config), new Date().toISOString());
        }
      } catch { /* invalid config is recovered by the config module */ }
    }

    const deleted = db.prepare("DELETE FROM users WHERE id = ? AND role != 'superadmin'").run(userId);
    if (!deleted.changes) throw new AuthError("최고 관리자 계정은 삭제할 수 없습니다.", 409);
  })();

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

export function updateUserPreferences(userId: string, displayName: string, preferences: Record<string, unknown>) {
  db.prepare("UPDATE users SET display_name = ?, preferences = ?, updated_at = ? WHERE id = ?")
    .run(displayName, JSON.stringify(preferences), new Date().toISOString(), userId);
}
