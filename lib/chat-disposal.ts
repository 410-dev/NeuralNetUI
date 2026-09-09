type Disposal = { userId: string; discard: () => void };
declare global { var neuralChatDisposals: Map<string, Disposal> | undefined; }
const disposals = globalThis.neuralChatDisposals ??= new Map<string, Disposal>();

export function registerChatDisposal(id: string, userId: string, discard: () => void) {
  const entry = { userId, discard };
  disposals.set(id, entry);
  return () => { if (disposals.get(id) === entry) disposals.delete(id); };
}

/** True while a chat job for this conversation is still registered, streaming or just finished. */
export function hasChatDisposal(conversationId: string, userId: string) {
  return disposals.get(conversationId)?.userId === userId;
}

export function discardChatJobs(userId: string, conversationId?: string) {
  for (const [id, entry] of disposals) {
    if (entry.userId !== userId || conversationId && id !== conversationId) continue;
    disposals.delete(id); entry.discard();
  }
}
