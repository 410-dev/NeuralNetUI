import type { ConnectionState } from "./connection-status";
import type { ConnectionConfig, ModelConfig } from "./types";

export type ServerState = ConnectionState;

/**
 * A model follows its server: switched off by an administrator, reported unreachable, answering with an error,
 * or online. Unchecked servers count as online.
 */
export function modelServerState(model: Pick<ModelConfig, "connectionId">, connections: Array<Pick<ConnectionConfig, "id" | "disabled">>, statuses: Record<string, ServerState>): ServerState {
  if (!model.connectionId) return "online";
  if (connections.find(connection => connection.id === model.connectionId)?.disabled) return "disabled";
  const state = statuses[model.connectionId];
  return state === "offline" || state === "error" ? state : "online";
}

/** A server that answers with an error still takes requests, so its models stay selectable and are only flagged. */
export function selectableState(state: ServerState) { return state === "online" || state === "error"; }

/** Models from disabled or unreachable servers leave every model-facing list. */
export function connectedModels<T extends Pick<ModelConfig, "connectionId">>(models: T[], connections: Array<Pick<ConnectionConfig, "id" | "disabled">>, statuses: Record<string, ServerState>): T[] {
  return models.filter(model => selectableState(modelServerState(model, connections, statuses)));
}

/**
 * The model to switch to when the selection's server is not online: the default model when it is online,
 * otherwise the first online model. Undefined keeps the selection (already online, or nothing is online).
 */
export function onlineReplacement<T extends Pick<ModelConfig, "id">>(selectedId: string | undefined, online: T[], defaultId?: string): T | undefined {
  if (!online.length || online.some(model => model.id === selectedId)) return undefined;
  return online.find(model => model.id === defaultId) || online[0];
}
