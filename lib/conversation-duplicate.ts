import type { ChatBranch, Conversation, StoredMessage } from "./types";

/**
 * Copies a chat with every branch intact. Branch and message identifiers are primary keys shared by
 * the whole database, so a copy that reused them would be silently dropped on write: each one is
 * remapped here, and every reference to them — active branch, parent branch, fork point and
 * revision group — follows the same map so the copy keeps its revision history.
 */
export function duplicateConversation(source: Conversation, options: { id: string; title: string; stamp: string; newId: (kind: "branch" | "message") => string }): Conversation {
  const { id, title, stamp, newId } = options;
  const branchIds = new Map<string, string>();
  const messageIds = new Map<string, string>();
  for (const branch of source.branches) {
    if (!branchIds.has(branch.id)) branchIds.set(branch.id, newId("branch"));
    for (const message of branch.messages) if (!messageIds.has(message.id)) messageIds.set(message.id, newId("message"));
  }
  const mapMessage = (messageId: string) => messageIds.get(messageId) || messageId;
  const copyMessage = (message: StoredMessage): StoredMessage => ({
    ...message,
    id: mapMessage(message.id),
    ...(message.revisionGroupId ? { revisionGroupId: mapMessage(message.revisionGroupId) } : {}),
  });
  const copyBranch = (branch: ChatBranch): ChatBranch => ({
    ...branch,
    id: branchIds.get(branch.id) as string,
    ...(branch.parentBranchId ? { parentBranchId: branchIds.get(branch.parentBranchId) || branch.parentBranchId } : {}),
    ...(branch.forkedFromMessageId ? { forkedFromMessageId: mapMessage(branch.forkedFromMessageId) } : {}),
    messages: branch.messages.map(copyMessage),
  });
  return {
    ...source,
    id,
    title,
    temporary: false,
    activeBranchId: branchIds.get(source.activeBranchId) || branchIds.get(source.branches[0].id) as string,
    branches: source.branches.map(copyBranch),
    createdAt: stamp,
    updatedAt: stamp,
  };
}
