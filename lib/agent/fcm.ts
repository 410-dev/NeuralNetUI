import { createSign } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dataDir } from "../database";

/**
 * Firebase Cloud Messaging (HTTP v1) for the mobile app. Each self-hosted server uses its own Firebase project: the
 * superadmin uploads the project's service account key in the web UI (kept in data/secrets/, which the app's backup
 * images never include), or the host provides it as a file (NEURAL_CHAT_FIREBASE_CREDENTIALS, or
 * `firebase-admin.json` in NEURAL_CHAT_SECRETS_DIR). An uploaded key takes precedence. The app must be built with
 * the same project's google-services.json. Without a key the app's devices are simply not notified.
 */
type ServiceAccount = { project_id: string; client_email: string; private_key: string; token_uri?: string };

const uploadedPath = () => path.join(dataDir, "secrets", "firebase-admin.json");
const hostPath = () => process.env.NEURAL_CHAT_FIREBASE_CREDENTIALS || path.join(process.env.NEURAL_CHAT_SECRETS_DIR || "/app/secrets", "firebase-admin.json");

function parseAccount(text: string): ServiceAccount {
  let parsed: Partial<ServiceAccount> & { type?: string };
  try { parsed = JSON.parse(text); } catch { throw Object.assign(new Error("JSON 파일이 아닙니다."), { status: 400 }); }
  if (parsed.type !== "service_account" || !parsed.project_id || !parsed.client_email || !parsed.private_key?.includes("PRIVATE KEY"))
    throw Object.assign(new Error("Firebase 서비스 계정 키가 아닙니다. Firebase 콘솔 > 프로젝트 설정 > 서비스 계정에서 받은 파일을 올려 주세요."), { status: 400 });
  return parsed as ServiceAccount;
}

let account: { value?: ServiceAccount; source?: "upload" | "file"; checked: number } = { checked: 0 };
function serviceAccount(): ServiceAccount | undefined {
  // Re-read at most once a minute so a key put in place by the host is picked up without a restart.
  if (account.value || Date.now() - account.checked < 60_000) return account.value;
  account = { checked: Date.now() };
  for (const [file, source] of [[uploadedPath(), "upload"], [hostPath(), "file"]] as const) {
    if (!existsSync(file)) continue;
    try { account = { value: parseAccount(readFileSync(file, "utf8")), source, checked: Date.now() }; break; }
    catch (error) { console.warn(`Firebase credentials in ${file} could not be used`, error instanceof Error ? error.message : error); }
  }
  return account.value;
}
function forget() { account = { checked: 0 }; token = undefined; }

export type FirebaseStatus = { configured: boolean; source?: "upload" | "file"; projectId?: string; clientEmail?: string; hostFile: boolean };
export function firebaseStatus(): FirebaseStatus {
  const sa = serviceAccount();
  return { configured: Boolean(sa), source: account.source, projectId: sa?.project_id, clientEmail: sa?.client_email, hostFile: existsSync(hostPath()) };
}
export function firebaseProjectId() { return serviceAccount()?.project_id; }

/** Checks the key by signing in to Google with it before storing it, so a wrong or revoked key is refused at once. */
export async function saveFirebaseCredentials(text: string) {
  const candidate = parseAccount(text);
  try { await signIn(candidate); } catch (error) { throw Object.assign(new Error(`이 키로 Firebase에 로그인하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`), { status: 400 }); }
  const file = uploadedPath();
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  chmodSync(path.dirname(file), 0o700);
  writeFileSync(`${file}.tmp`, text, { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
  forget();
  return firebaseStatus();
}

export function removeUploadedFirebaseCredentials() { rmSync(uploadedPath(), { force: true }); forget(); return firebaseStatus(); }

export function fcmConfigured() { return Boolean(serviceAccount()); }

const base64url = (input: string | Buffer) => Buffer.from(input).toString("base64url");

let token: { value: string; expires: number } | undefined;
async function accessToken(sa: ServiceAccount) {
  if (token && token.expires - 60_000 > Date.now()) return token.value;
  token = await signIn(sa);
  return token.value;
}

async function signIn(sa: ServiceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = sa.token_uri || "https://oauth2.googleapis.com/token";
  const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: tokenUri, iat: now, exp: now + 3600 }))}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key);
  const response = await fetch(tokenUri, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${base64url(signature)}` }), signal: AbortSignal.timeout(15_000) });
  const body = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!response.ok || !body.access_token) throw new Error(`Firebase sign-in failed: ${body.error_description || body.error || response.status}`);
  return { value: body.access_token, expires: Date.now() + (body.expires_in ?? 3600) * 1000 };
}

/** Android channels the app creates: urgent ones interrupt (sound, heads-up), the rest wait quietly in the shade. */
export const FCM_CHANNEL = { urgent: "agent-urgent", normal: "agent" } as const;

export type FcmMessage = { title: string; body: string; urgent: boolean; url: string };
export type FcmResult = { ok: boolean; status?: number; error?: string; gone?: boolean };

export async function sendFcm(deviceToken: string, message: FcmMessage): Promise<FcmResult> {
  const sa = serviceAccount();
  if (!sa) return { ok: false, error: "서버에 Firebase 서비스 계정 키가 없습니다. 관리자 설정 > 데이터에서 올려 주세요." };
  try {
    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`, {
      method: "POST", headers: { Authorization: `Bearer ${await accessToken(sa)}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ message: {
        token: deviceToken,
        notification: { title: message.title, body: message.body },
        data: { url: message.url, urgent: message.urgent ? "1" : "0" },
        android: { priority: message.urgent ? "HIGH" : "NORMAL", ttl: "3600s", notification: { channel_id: message.urgent ? FCM_CHANNEL.urgent : FCM_CHANNEL.normal, ...(message.urgent ? { notification_priority: "PRIORITY_HIGH" } : {}) } },
        apns: { headers: { "apns-priority": message.urgent ? "10" : "5" }, payload: { aps: { "interruption-level": message.urgent ? "time-sensitive" : "passive", sound: message.urgent ? "default" : undefined } } },
      } }),
    });
    if (response.ok) return { ok: true, status: response.status };
    const body = await response.json().catch(() => ({})) as { error?: { message?: string; status?: string; details?: Array<{ errorCode?: string }> } };
    const code = body.error?.details?.find(item => item.errorCode)?.errorCode || body.error?.status;
    // The app was uninstalled or the token was replaced: the registration is dropped.
    const gone = response.status === 404 || code === "UNREGISTERED" || (code === "INVALID_ARGUMENT" && /registration token/i.test(body.error?.message || ""));
    const mismatch = code === "SENDER_ID_MISMATCH" ? "앱과 서버의 Firebase 프로젝트가 다릅니다 (SENDER_ID_MISMATCH). 앱을 이 서버의 google-services.json으로 빌드해야 합니다." : "";
    return { ok: false, status: response.status, error: (mismatch || `${code || ""} ${body.error?.message || ""}`.trim()).slice(0, 300), gone };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}
