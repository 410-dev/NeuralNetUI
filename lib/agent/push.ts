import webpush from "web-push";
import { db } from "../database";
import { sendFcm } from "./fcm";

/**
 * Web Push for the agent. The server's VAPID key pair is created once and kept in the database. A message goes to
 * every device the person registered, tagged so a later "seen" push replaces and closes it on all of them.
 */
type Keys = { publicKey: string; privateKey: string };

function vapidKeys(): Keys {
  const row = db.prepare("SELECT value FROM app_secrets WHERE name = 'vapid'").get() as { value: string } | undefined;
  if (row) return JSON.parse(row.value) as Keys;
  const keys = webpush.generateVAPIDKeys();
  db.prepare("INSERT OR IGNORE INTO app_secrets(name, value, created_at) VALUES ('vapid', ?, ?)").run(JSON.stringify(keys), new Date().toISOString());
  return JSON.parse((db.prepare("SELECT value FROM app_secrets WHERE name = 'vapid'").get() as { value: string }).value) as Keys;
}

export function vapidPublicKey() { return vapidKeys().publicKey; }

/** Push services (Apple's in particular) want a reachable contact: this NeuralNetUI's https address, saved when a device subscribes. */
export function rememberPushSubject(origin: string) {
  if (!/^https:\/\//.test(origin)) return;
  db.prepare("INSERT INTO app_secrets(name, value, created_at) VALUES ('vapid_subject', ?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value").run(origin, new Date().toISOString());
}
function pushSubject() {
  return (db.prepare("SELECT value FROM app_secrets WHERE name = 'vapid_subject'").get() as { value: string } | undefined)?.value || "mailto:push@neuralnetui.app";
}

export function savePushSubscription(userId: string, input: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }, userAgent?: string) {
  const endpoint = typeof input.endpoint === "string" ? input.endpoint : "";
  const p256dh = typeof input.keys?.p256dh === "string" ? input.keys.p256dh : "", auth = typeof input.keys?.auth === "string" ? input.keys.auth : "";
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 2000 || !p256dh || !auth) throw Object.assign(new Error("Invalid push subscription."), { status: 400 });
  db.prepare(`INSERT INTO push_subscriptions(endpoint, user_id, p256dh, auth, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent`)
    .run(endpoint, userId, p256dh, auth, userAgent?.slice(0, 300) ?? null, new Date().toISOString());
}

export function removePushSubscription(userId: string, endpoint: string) {
  db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?").run(endpoint, userId);
}

/** The mobile app registers its FCM token (Android, and iOS later) through the page it hosts. */
export function saveNativePushToken(userId: string, input: { token?: unknown; platform?: unknown }, userAgent?: string) {
  const token = typeof input.token === "string" ? input.token.trim() : "";
  const platform = input.platform === "ios" ? "ios" : input.platform === "android" ? "android" : "";
  if (!token || token.length > 4096 || !platform) throw Object.assign(new Error("Invalid device token."), { status: 400 });
  db.prepare(`INSERT INTO native_push_tokens(token, user_id, platform, user_agent, created_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, user_agent = excluded.user_agent`)
    .run(token, userId, platform, userAgent?.slice(0, 300) ?? null, new Date().toISOString());
}

export function removeNativePushToken(userId: string, token: string) {
  db.prepare("DELETE FROM native_push_tokens WHERE token = ? AND user_id = ?").run(token, userId);
}

export function hasNativePushToken(userId: string, token: string) {
  return Boolean(db.prepare("SELECT 1 FROM native_push_tokens WHERE user_id = ? AND token = ?").get(userId, token));
}

export function pushDeviceCount(userId: string) {
  const web = (db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?").get(userId) as { n: number }).n;
  const native = (db.prepare("SELECT COUNT(*) AS n FROM native_push_tokens WHERE user_id = ?").get(userId) as { n: number }).n;
  return web + native;
}

/** `urgent` interrupts the person (sound, heads-up); otherwise the notification waits quietly where they will see it. */
type Payload = { title: string; body: string; tag?: string; url?: string; close?: boolean; urgent?: boolean };

export type PushResult = { endpoint: string; ok: boolean; status?: number; error?: string };

/** Sends to every device; subscriptions the push service reports as gone are removed. */
export async function pushToUser(userId: string, payload: Payload): Promise<PushResult[]> {
  const rows = db.prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?").all(userId) as Array<{ endpoint: string; p256dh: string; auth: string }>;
  // A "close" push only tidies browsers; the app clears its own notifications when opened.
  const native = payload.close ? [] : db.prepare("SELECT token, platform FROM native_push_tokens WHERE user_id = ?").all(userId) as Array<{ token: string; platform: string }>;
  if (!rows.length && !native.length) return [];
  const keys = vapidKeys();
  const body = JSON.stringify({ tag: "neuralnetui-agent", url: "/?agent=1", ...payload });
  const nativeResults = native.map(async (row): Promise<PushResult> => {
    const sent = await sendFcm(row.token, { title: payload.title, body: payload.body, urgent: payload.urgent === true, url: payload.url || "/?agent=1" });
    if (sent.ok) db.prepare("UPDATE native_push_tokens SET last_used_at = ? WHERE token = ?").run(new Date().toISOString(), row.token);
    else if (sent.gone) db.prepare("DELETE FROM native_push_tokens WHERE token = ?").run(row.token);
    else console.warn("App push delivery failed", sent.status, sent.error);
    return { endpoint: `${row.platform} app`, ok: sent.ok, status: sent.status, error: sent.error };
  });
  const webResults = rows.map(async (row): Promise<PushResult> => {
    try {
      const sent = await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, body, { vapidDetails: { subject: pushSubject(), publicKey: keys.publicKey, privateKey: keys.privateKey }, TTL: 3600, urgency: "high" });
      db.prepare("UPDATE push_subscriptions SET last_used_at = ? WHERE endpoint = ?").run(new Date().toISOString(), row.endpoint);
      return { endpoint: new URL(row.endpoint).host, ok: true, status: sent.statusCode };
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      // Network failures carry no message, only a code (ECONNREFUSED, ETIMEDOUT…); say which.
      const code = (error as { code?: string; errors?: Array<{ code?: string }> }).code || (error as { errors?: Array<{ code?: string }> }).errors?.[0]?.code;
      const detail = String((error as { body?: string }).body || (error instanceof Error && error.message) || (code ? `could not reach the push service (${code})` : String(error))).slice(0, 300);
      if (status === 404 || status === 410) db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(row.endpoint);
      else console.warn("Push delivery failed", status, detail);
      return { endpoint: new URL(row.endpoint).host, ok: false, status, error: detail };
    }
  });
  return Promise.all([...webResults, ...nativeResults]);
}

declare global { var neuralPushPending: Set<string> | undefined; }
const pending = globalThis.neuralPushPending ??= new Set<string>();
export function markPushPending(userId: string) { pending.add(userId); }

/**
 * Once the person looks at the agent on any device, the notification still showing on the others is closed. Sent only
 * when something was pushed since: each push must show a notification, and iOS drops subscriptions that do not.
 */
export async function clearPushedNotifications(userId: string) {
  if (!pending.delete(userId)) return;
  await pushToUser(userId, { title: "", body: "", close: true });
}

/** Whether this endpoint is registered for the account (the screen shows the real state, not just the browser's). */
export function hasPushSubscription(userId: string, endpoint: string) {
  return Boolean(db.prepare("SELECT 1 FROM push_subscriptions WHERE user_id = ? AND endpoint = ?").get(userId, endpoint));
}
