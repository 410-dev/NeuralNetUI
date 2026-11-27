import { createSign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Firebase Cloud Messaging (HTTP v1) for the mobile app. The server signs in with a Firebase service account read
 * from NEURAL_CHAT_FIREBASE_CREDENTIALS, or `firebase-admin.json` in NEURAL_CHAT_SECRETS_DIR (default /app/secrets).
 * Without that file the app's devices are simply not notified; web push is unaffected.
 */
type ServiceAccount = { project_id: string; client_email: string; private_key: string; token_uri?: string };

function credentialsPath() {
  return process.env.NEURAL_CHAT_FIREBASE_CREDENTIALS || path.join(process.env.NEURAL_CHAT_SECRETS_DIR || "/app/secrets", "firebase-admin.json");
}

let account: { value?: ServiceAccount; checked: number } = { checked: 0 };
function serviceAccount(): ServiceAccount | undefined {
  // Re-read at most once a minute so a key put in place later is picked up without a restart.
  if (account.value || Date.now() - account.checked < 60_000) return account.value;
  account = { checked: Date.now() };
  const file = credentialsPath();
  if (!existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<ServiceAccount>;
    if (parsed.project_id && parsed.client_email && parsed.private_key) account.value = parsed as ServiceAccount;
    else console.warn("Firebase credentials are missing project_id, client_email or private_key");
  } catch (error) { console.warn("Firebase credentials could not be read", error instanceof Error ? error.message : error); }
  return account.value;
}

export function fcmConfigured() { return Boolean(serviceAccount()); }

const base64url = (input: string | Buffer) => Buffer.from(input).toString("base64url");

let token: { value: string; expires: number } | undefined;
async function accessToken(sa: ServiceAccount) {
  if (token && token.expires - 60_000 > Date.now()) return token.value;
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = sa.token_uri || "https://oauth2.googleapis.com/token";
  const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: tokenUri, iat: now, exp: now + 3600 }))}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key);
  const response = await fetch(tokenUri, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${base64url(signature)}` }), signal: AbortSignal.timeout(15_000) });
  const body = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!response.ok || !body.access_token) throw new Error(`Firebase sign-in failed: ${body.error_description || body.error || response.status}`);
  token = { value: body.access_token, expires: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return token.value;
}

/** Android channels the app creates: urgent ones interrupt (sound, heads-up), the rest wait quietly in the shade. */
export const FCM_CHANNEL = { urgent: "agent-urgent", normal: "agent" } as const;

export type FcmMessage = { title: string; body: string; urgent: boolean; url: string };
export type FcmResult = { ok: boolean; status?: number; error?: string; gone?: boolean };

export async function sendFcm(deviceToken: string, message: FcmMessage): Promise<FcmResult> {
  const sa = serviceAccount();
  if (!sa) return { ok: false, error: "Firebase credentials are not installed on the server." };
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
    return { ok: false, status: response.status, error: `${code || ""} ${body.error?.message || ""}`.trim().slice(0, 300), gone };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}
