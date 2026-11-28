import { db } from "./database.ts";
import type { ConnectionConfig, ModelConfig } from "./types.ts";

/** Request and response header that names the LMFuseFramework session a chat continues; "new" opens one. */
export const LMF_SESSION_HEADER = "X-LMF-Session";
export const LMF_DEFAULT_DISCOUNT_PERCENT = 90;
export const LMF_DEFAULT_SESSION_TTL_HOURS = 24;

/** One provider a routing model may pick (`/v1/lmf/route` providers, `route.current`, `route.next.next`). */
export type LmfRouteEntry = { provider: string; model?: string; effort?: string; template?: string; position?: number };
export type LmfRouting = { entry: LmfRouteEntry; label: string; when: "next" | "current" };

const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;
function record(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }

export function routeEntry(value: unknown): LmfRouteEntry | undefined {
  const item = record(value); const provider = text(item?.provider);
  if (!item || !provider) return undefined;
  return { provider, model: text(item.model), effort: text(item.effort), template: text(item.template), position: typeof item.position === "number" ? item.position : undefined };
}

/** Display names are keyed by provider and model, so every effort level of one model shares a name. */
export function lmfRouteKey(entry: Pick<LmfRouteEntry, "provider" | "model" | "template">) {
  return `${entry.provider}/${entry.model || entry.template || ""}`;
}

export function lmfRouteLabel(model: Pick<ModelConfig, "routeDisplayNames">, entry: LmfRouteEntry) {
  return model.routeDisplayNames?.[lmfRouteKey(entry)]?.trim() || [entry.provider, entry.model || entry.template].filter(Boolean).join(" · ");
}

/** Every provider in the routing order, de-duplicated by display-name key. */
export function routeEntries(payload: unknown): LmfRouteEntry[] {
  const providers = record(payload)?.providers;
  const seen = new Set<string>();
  return (Array.isArray(providers) ? providers : []).map(routeEntry).filter((entry): entry is LmfRouteEntry => {
    if (!entry || seen.has(lmfRouteKey(entry))) return false;
    seen.add(lmfRouteKey(entry)); return true;
  });
}

/** Where a session's next turn goes ("next") or what its last turn used ("current"); one-shot routing when there is no session. */
export function routingFrom(payload: unknown, when: "next" | "current"): LmfRouteEntry | undefined {
  const value = record(payload);
  if (!value) return undefined;
  if (value.object === "lmf.route") return routeEntry(record(value.next_one_shot)?.next);
  const route = record(value.route);
  // A route session overview is `{ current, strategy, next: <entry>, skipped }`.
  if (when === "next") return routeEntry(route?.next) || routeEntry(route?.current);
  const last = record(value.last);
  return routeEntry(route?.current) || (last && text(last.provider) ? routeEntry({ provider: last.provider, model: last.model, effort: last.effort }) : undefined);
}

/** Prompt-cache lifetime of a routing session's current provider: seconds left and the provider's full cache TTL. */
export function cacheFrom(payload: unknown): { remainingSeconds: number; totalSeconds?: number; entry: LmfRouteEntry } | undefined {
  const current = record(record(record(payload)?.route)?.current);
  const entry = routeEntry(current);
  const remaining = current?.cache_ttl_remaining_seconds;
  if (!entry || typeof remaining !== "number" || !Number.isFinite(remaining)) return undefined;
  const minutes = current?.cachettl_minutes;
  return { remainingSeconds: Math.max(0, remaining), totalSeconds: typeof minutes === "number" && minutes > 0 ? Math.round(minutes * 60) : undefined, entry };
}

/** `/v1/lmf/...` next to the connection's OpenAI base URL. */
export function lmfEndpoint(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}/lmf/${path.replace(/^\/+/, "")}`;
}

/** The session id a response names: the `X-LMF-Session` header, or `lmf.session` in the body or first stream chunk. */
export function lmfSessionFrom(headers: Headers | undefined, payload?: unknown) {
  return text(headers?.get(LMF_SESSION_HEADER)) || text(record(record(payload)?.lmf)?.session);
}

export function lmfSessionTtlMs(connection: Pick<ConnectionConfig, "lmfSessionTtlHours">) {
  return Math.min(8760, Math.max(1, connection.lmfSessionTtlHours ?? LMF_DEFAULT_SESSION_TTL_HOURS)) * 3600_000;
}

/** The session a chat continues; one unused for longer than the TTL is not offered (the sweeper deletes it). */
export function storedLmfSession(conversationId: string, connectionId: string, model: string, ttlMs = Infinity, now = Date.now()) {
  const row = db.prepare("SELECT session_id, updated_at FROM lmf_sessions WHERE conversation_id = ? AND connection_id = ? AND model = ?").get(conversationId, connectionId, model) as { session_id: string; updated_at: string } | undefined;
  return row && now - Date.parse(row.updated_at) <= ttlMs ? row.session_id : undefined;
}

export function saveLmfSession(conversationId: string, connectionId: string, model: string, sessionId: string) {
  db.prepare(`INSERT INTO lmf_sessions(conversation_id, connection_id, model, session_id, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(conversation_id, connection_id, model) DO UPDATE SET session_id = excluded.session_id, updated_at = excluded.updated_at`)
    .run(conversationId, connectionId, model, sessionId, new Date().toISOString());
}

/** Every LMFuseFramework session recorded for one chat (one per connection and model). */
export function lmfSessionRowsFor(conversationId: string): LmfSessionRow[] {
  return (db.prepare("SELECT conversation_id AS conversationId, connection_id AS connectionId, model, session_id AS sessionId, updated_at AS updatedAt FROM lmf_sessions WHERE conversation_id = ?").all(conversationId) as Array<Omit<LmfSessionRow, "conversationGone">>)
    .map(row => ({ ...row, conversationGone: false }));
}

/** `GET /v1/lmf/sessions/{id}`: the prompt-cache state of a routing session's current provider, if the server reports one. */
export async function lmfSessionCache(connection: Pick<ConnectionConfig, "baseUrl">, headers: Record<string, string>, sessionId: string, request: typeof fetch = fetch) {
  const response = await request(lmfEndpoint(connection.baseUrl, `sessions/${encodeURIComponent(sessionId)}`), { headers, signal: AbortSignal.timeout(10_000), cache: "no-store" });
  if (!response.ok) { await response.body?.cancel().catch(() => undefined); return undefined; }
  return cacheFrom(await response.json());
}

export function forgetLmfSession(conversationId: string, connectionId: string, model: string) {
  db.prepare("DELETE FROM lmf_sessions WHERE conversation_id = ? AND connection_id = ? AND model = ?").run(conversationId, connectionId, model);
}

export type LmfSessionRow = { conversationId: string; connectionId: string; model: string; sessionId: string; updatedAt: string; conversationGone: boolean };

/** Sessions whose chat was deleted (to the trash or for good), or that went unused for longer than their connection's TTL. */
export function staleLmfSessions(connections: Array<Pick<ConnectionConfig, "id" | "driver" | "lmfSessionTtlHours">>, now = Date.now()): LmfSessionRow[] {
  const rows = db.prepare(`SELECT s.conversation_id AS conversationId, s.connection_id AS connectionId, s.model, s.session_id AS sessionId, s.updated_at AS updatedAt,
      (c.id IS NULL OR c.deleted_at IS NOT NULL) AS gone FROM lmf_sessions s LEFT JOIN conversations c ON c.id = s.conversation_id`).all() as Array<Omit<LmfSessionRow, "conversationGone"> & { gone: number }>;
  return rows.map(({ gone, ...row }) => ({ ...row, conversationGone: gone === 1 })).filter(row => {
    const connection = connections.find(item => item.id === row.connectionId);
    return row.conversationGone || !connection || connection.driver !== "lmf" || now - Date.parse(row.updatedAt) > lmfSessionTtlMs(connection);
  });
}

/** Removes the local record only if it still names this session (a newer turn may have replaced it meanwhile). */
export function dropLmfSessionRow(row: Pick<LmfSessionRow, "conversationId" | "connectionId" | "model" | "sessionId">) {
  db.prepare("DELETE FROM lmf_sessions WHERE conversation_id = ? AND connection_id = ? AND model = ? AND session_id = ?").run(row.conversationId, row.connectionId, row.model, row.sessionId);
}

/** `DELETE /v1/lmf/sessions/{id}?purge=1`: closes the session and asks the server to delete its records. A session already gone counts as done. */
export async function deleteRemoteLmfSession(connection: Pick<ConnectionConfig, "baseUrl">, headers: Record<string, string>, sessionId: string, request: typeof fetch = fetch) {
  const response = await request(`${lmfEndpoint(connection.baseUrl, `sessions/${encodeURIComponent(sessionId)}`)}?purge=1`, { method: "DELETE", headers, signal: AbortSignal.timeout(15_000), cache: "no-store" });
  await response.body?.cancel().catch(() => undefined);
  return response.ok || response.status === 404;
}

/** What a session's last turn used, as its display label (`GET /v1/lmf/sessions/{id}`). */
export async function routedModelLabel(connection: Pick<ConnectionConfig, "baseUrl">, headers: Record<string, string>, sessionId: string, model: Pick<ModelConfig, "routeDisplayNames">, request: typeof fetch = fetch) {
  const response = await request(lmfEndpoint(connection.baseUrl, `sessions/${encodeURIComponent(sessionId)}`), { headers, signal: AbortSignal.timeout(5_000), cache: "no-store" });
  if (!response.ok) { await response.body?.cancel().catch(() => undefined); return undefined; }
  const entry = routingFrom(await response.json(), "current");
  return entry ? lmfRouteLabel(model, entry) : undefined;
}

/** A closed or expired session is answered with 404 `session_not_found`; the chat then opens a new one. */
export function isLmfSessionGone(status: number, body: string) {
  return status === 404 && /session_not_found|session/i.test(body);
}

/** Input tokens a plan is charged: cached prompt tokens count at the connection's discount while it is on. */
export function lmfChargedInput(connection: Pick<ConnectionConfig, "lmfCacheDiscount" | "lmfCacheDiscountPercent">, inputTokens: number, cachedTokens = 0) {
  if (connection.lmfCacheDiscount === false || cachedTokens <= 0) return inputTokens;
  const percent = Math.min(100, Math.max(0, connection.lmfCacheDiscountPercent ?? LMF_DEFAULT_DISCOUNT_PERCENT));
  return Math.max(0, Math.round(inputTokens - Math.min(cachedTokens, inputTokens) * percent / 100));
}

/** One provider window of a routing target: how much of it is used, the routing threshold and when it resets. */
export type LmfQuotaWindow = { name: string; usedPercent: number; thresholdPercent?: number; windowSeconds?: number; resetsAt?: string; observedAt?: string; source: "provider" | "config" };
/** A routing target with its remaining provider quota; `windows` is empty when the provider reports none. */
export type LmfQuotaTarget = { key: string; label: string; position?: number; available: boolean; windows: LmfQuotaWindow[] };

/** Route windows (`/v1/lmf/route` providers[].windows, `/v1/lmf/route/agy-quota` targets[].windows) in display shape. */
function quotaWindows(value: unknown): LmfQuotaWindow[] {
  return (Array.isArray(value) ? value : []).flatMap(raw => {
    const w = record(raw); const used = w?.used;
    if (!w || typeof used !== "number" || !Number.isFinite(used)) return [];
    const threshold = typeof w.threshold === "number" ? w.threshold : undefined;
    const observed = typeof w.observed_at === "number" && w.observed_at > 0 ? new Date(w.observed_at * 1000).toISOString() : undefined;
    return [{ name: text(w.name) || "", usedPercent: Math.round(used * 1000) / 10, thresholdPercent: threshold === undefined ? undefined : Math.round(threshold * 1000) / 10,
      windowSeconds: typeof w.window_seconds === "number" && w.window_seconds > 0 ? w.window_seconds : undefined, resetsAt: text(w.resets_at), observedAt: observed,
      source: w.source === "config" ? "config" as const : "provider" as const }];
  });
}

/** Identifies one routing target across `/v1/lmf/route` and `/v1/lmf/route/agy-quota`. */
export function quotaTargetKey(entry: LmfRouteEntry) {
  return `${entry.position ?? ""}:${lmfRouteKey(entry)}:${entry.effort ?? ""}`;
}

/** The routing targets of `/v1/lmf/route` with their usage windows, in routing order. */
export function quotaTargets(payload: unknown, model: Pick<ModelConfig, "routeDisplayNames">): LmfQuotaTarget[] {
  const providers = record(payload)?.providers;
  return (Array.isArray(providers) ? providers : []).flatMap(item => {
    const entry = routeEntry(item); const value = record(item);
    if (!entry || !value) return [];
    return [{ key: quotaTargetKey(entry), label: lmfRouteLabel(model, entry), position: entry.position, available: value.available !== false, windows: quotaWindows(value.windows) }];
  });
}

/** Antigravity quota of one routing target, read by LMF from the CLI's TUI (`/v1/lmf/route/agy-quota`, LMF 0.3.12+). */
export type LmfAgyQuota = { key: string; windows: LmfQuotaWindow[]; group?: string; error?: string };

export function agyQuotaTargets(payload: unknown): LmfAgyQuota[] {
  const targets = record(payload)?.targets;
  return (Array.isArray(targets) ? targets : []).flatMap(item => {
    const entry = routeEntry(item); const value = record(item);
    if (!entry || !value) return [];
    return [{ key: quotaTargetKey(entry), windows: quotaWindows(value.windows), group: text(value.group), error: text(value.error) }];
  });
}
