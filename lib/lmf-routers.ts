import { readConfig } from "./config";
import { planServesModel } from "./plans";
import type { ConnectionConfig, ModelConfig } from "./types";

/** One LMFuseFramework connection per routing model the account may use (the first such model names it). */
export async function lmfRouterConnections(userId: string): Promise<Array<{ model: ModelConfig; connection: ConnectionConfig }>> {
  const config = await readConfig();
  const routers = config.models.filter(model => model.routerModel && !model.isAlias && model.visible !== false && model.connectionId && planServesModel(userId, model.id, model.sourceModel));
  const seen = new Set<string>();
  return routers.filter(model => !seen.has(model.connectionId!) && seen.add(model.connectionId!)).flatMap(model => {
    const connection = config.connections.find(item => item.id === model.connectionId);
    return connection && connection.driver === "lmf" && !connection.disabled ? [{ model, connection }] : [];
  });
}
