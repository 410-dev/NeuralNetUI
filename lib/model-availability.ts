import type { ConnectionState } from "./connection-status";
import type { ConnectionConfig, ModelConfig } from "./types";

export type ServerState = ConnectionState;

/** A model follows its server: switched off by an administrator, reported unreachable, or usable. Unchecked servers count as online. */
export function modelServerState(model: Pick<ModelConfig, "connectionId">, connections: Array<Pick<ConnectionConfig, "id" | "disabled">>, statuses: Record<string, ServerState>): ServerState {
  if (!model.connectionId) return "online";
  if (connections.find(connection => connection.id === model.connectionId)?.disabled) return "disabled";
  return statuses[model.connectionId] === "offline" ? "offline" : "online";
}

/**
 * The model to switch to when the selection's server is not online: the default model when it is online,
 * otherwise the first online model. Undefined keeps the selection (already online, or nothing is online).
 */
export function onlineReplacement<T extends Pick<ModelConfig, "id">>(selectedId: string | undefined, online: T[], defaultId?: string): T | undefined {
  if (!online.length || online.some(model => model.id === selectedId)) return undefined;
  return online.find(model => model.id === defaultId) || online[0];
}
