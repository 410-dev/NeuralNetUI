import { connectionHeaders, envApiKey } from "./connection-drivers";
import { deleteRemoteLmfSession, dropLmfSessionRow, lmfSessionCache, lmfSessionRowsFor, staleLmfSessions } from "./lmf";

declare global {
  var neuralLmfSweep: Promise<void> | undefined;
  var neuralLmfSweepTimer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * Deletes the LMFuseFramework sessions of deleted chats and of chats idle past the connection's TTL, on the server
 * and here. The chat itself stays; its next request opens a new session from the full history. A server that cannot
 * be reached keeps the record, so the next sweep tries again.
 */
export function sweepLmfSessions(): Promise<void> {
  globalThis.neuralLmfSweep ??= (async () => {
    const { readConfig } = await import("./config");
    const { connections } = await readConfig();
    for (const row of staleLmfSessions(connections)) {
      const connection = connections.find(item => item.id === row.connectionId);
      if (!connection || connection.driver !== "lmf") { dropLmfSessionRow(row); continue; }
      try { if (await deleteRemoteLmfSession(connection, connectionHeaders(connection, envApiKey(connection.driver)), row.sessionId)) dropLmfSessionRow(row); }
      catch (error) { console.warn(`Unable to delete LMFuseFramework session ${row.sessionId}; retrying later`, error instanceof Error ? error.message : error); }
    }
  })().catch(error => console.error("LMFuseFramework session sweep failed", error)).finally(() => { globalThis.neuralLmfSweep = undefined; });
  return globalThis.neuralLmfSweep;
}

/** Runs a sweep shortly after chats are deleted, so their sessions close without waiting for the periodic run. */
export function requestLmfSessionSweep() {
  if (globalThis.neuralLmfSweepTimer) return;
  globalThis.neuralLmfSweepTimer = setTimeout(() => { globalThis.neuralLmfSweepTimer = undefined; void sweepLmfSessions(); }, 500);
  globalThis.neuralLmfSweepTimer.unref?.();
}

/** The prompt cache of a chat's LMFuseFramework routing session: seconds left and the full TTL of its current provider. */
export async function lmfCacheOfConversation(conversationId: string) {
  const { readConfig } = await import("./config");
  const { connections } = await readConfig();
  for (const row of lmfSessionRowsFor(conversationId)) {
    const connection = connections.find(item => item.id === row.connectionId);
    if (!connection || connection.driver !== "lmf") continue;
    const cache = await lmfSessionCache(connection, connectionHeaders(connection, envApiKey(connection.driver)), row.sessionId).catch(() => undefined);
    if (cache) return cache;
  }
  return undefined;
}

/** Closes (and purges) a chat's LMFuseFramework sessions now; the chat keeps its history and opens a new session next time. */
export async function closeLmfSessionsOf(conversationId: string) {
  const { readConfig } = await import("./config");
  const { connections } = await readConfig();
  for (const row of lmfSessionRowsFor(conversationId)) {
    const connection = connections.find(item => item.id === row.connectionId);
    if (!connection || connection.driver !== "lmf") { dropLmfSessionRow(row); continue; }
    try { if (await deleteRemoteLmfSession(connection, connectionHeaders(connection, envApiKey(connection.driver)), row.sessionId)) dropLmfSessionRow(row); }
    catch (error) { console.warn(`Unable to close LMFuseFramework session ${row.sessionId}; the sweep retries later`, error instanceof Error ? error.message : error); }
  }
}
