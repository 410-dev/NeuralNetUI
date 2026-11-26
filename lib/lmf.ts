import { db } from "./database.ts";
import type { ConnectionConfig, ModelConfig } from "./types.ts";

/** Request and response header that names the LMFuseFramework session a chat continues; "new" opens one. */
export const LMF_SESSION_HEADER = "X-LMF-Session";
export const LMF_DEFAULT_DISCOUNT_PERCENT = 90;

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

/** `/v1/lmf/...` next to the connection's OpenAI base URL. */
export function lmfEndpoint(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}/lmf/${path.replace(/^\/+/, "")}`;
}

/** The session id a response names: the `X-LMF-Session` header, or `lmf.session` in the body or first stream chunk. */
export function lmfSessionFrom(headers: Headers | undefined, payload?: unknown) {
  return text(headers?.get(LMF_SESSION_HEADER)) || text(record(record(payload)?.lmf)?.session);
}

export function storedLmfSession(conversationId: string, connectionId: string, model: string) {
  const row = db.prepare("SELECT session_id FROM lmf_sessions WHERE conversation_id = ? AND connection_id = ? AND model = ?").get(conversationId, connectionId, model) as { session_id: string } | undefined;
  return row?.session_id;
}

export function saveLmfSession(conversationId: string, connectionId: string, model: string, sessionId: string) {
  db.prepare(`INSERT INTO lmf_sessions(conversation_id, connection_id, model, session_id, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(conversation_id, connection_id, model) DO UPDATE SET session_id = excluded.session_id, updated_at = excluded.updated_at`)
    .run(conversationId, connectionId, model, sessionId, new Date().toISOString());
}

export function forgetLmfSession(conversationId: string, connectionId: string, model: string) {
  db.prepare("DELETE FROM lmf_sessions WHERE conversation_id = ? AND connection_id = ? AND model = ?").run(conversationId, connectionId, model);
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
