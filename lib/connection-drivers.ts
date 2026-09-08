import type { ConnectionConfig, ConnectionDriver, ModelConfig } from "./types";
import { applyPreferredOrder } from "./ordered-list.ts";
import { inheritReasoning } from "./reasoning-capabilities.ts";

export function connectionRoot(baseUrl: string) {
  const url = new URL(baseUrl);
  url.pathname = url.pathname.replace(/\/(?:v1|api\/v[01])\/?$/, "") || "/";
  url.search = ""; url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function modelsEndpoint(driver: ConnectionDriver, baseUrl: string) {
  const base = baseUrl.replace(/\/$/, "");
  return driver === "lmstudio" ? `${connectionRoot(baseUrl)}/api/v1/models` : `${base}/models`;
}

export function chatEndpoint(driver: ConnectionDriver, baseUrl: string) {
  const base = baseUrl.replace(/\/$/, "");
  return driver === "lmstudio" ? `${connectionRoot(baseUrl)}/v1/chat/completions` : `${base}/chat/completions`;
}

export function lmStudioEndpoint(baseUrl: string, action: "load" | "unload") {
  return `${connectionRoot(baseUrl)}/api/v1/models/${action}`;
}

export function connectionHeaders(connection: Pick<ConnectionConfig, "apiKey" | "clearApiKey">, fallbackKey = "") {
  const apiKey = connection.clearApiKey ? "" : connection.apiKey || fallbackKey;
  return { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) };
}

export function resolveConnectionModels(connections: ConnectionConfig[], aliases: ModelConfig[] = [], preferredOrder: string[] = []) {
  const seen = new Set<string>(); const models: ModelConfig[] = [];
  for (const connection of connections) {
    for (const model of connection.models) {
      const identifier = model.sourceModel || model.id;
      if (seen.has(identifier)) continue;
      seen.add(identifier);
      models.push({ ...model, connectionId: connection.id });
    }
  }
  for (const alias of aliases.filter((model) => model.isAlias)) {
    const connection = connectionForModel(connections, alias);
    const base = connection?.models.find((model) => !model.isAlias && (model.sourceModel === alias.sourceModel || model.id === alias.sourceModel));
    models.push({ ...inheritReasoning(alias, base), connectionId: connection?.id });
  }
  return applyPreferredOrder(models, preferredOrder);
}

export function connectionForModel(connections: ConnectionConfig[], model: ModelConfig) {
  if (model.connectionId) {
    const direct = connections.find((connection) => connection.id === model.connectionId);
    if (direct && (!model.isAlias || direct.models.some(candidate => candidate.sourceModel === model.sourceModel || candidate.id === model.sourceModel))) return direct;
  }
  return connections.find((connection) => connection.models.some((candidate) => candidate.sourceModel === model.sourceModel || candidate.id === model.sourceModel || candidate.id === model.id));
}

/** Merge unsaved model edits before rebuilding the connection-derived picker list. */
export function reconcileConnectionEdits<T extends ConnectionConfig>(connections: T[], models: ModelConfig[]): T[] {
  const edits = new Map(models.filter(m => !m.isAlias && m.connectionId).map(m => [`${m.connectionId}\0${m.id}`, m]));
  return connections.map(c => ({ ...c, models: c.models.map(m => ({ ...m, ...edits.get(`${c.id}\0${m.id}`), connectionId: c.id })) }));
}
