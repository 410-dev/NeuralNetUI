import type { Conversation } from "./types";
import { removeUserMessagePair } from "./conversation-messages.ts";

/** Every revision of one message shares this identifier, whichever branch holds it. */
export function revisionGroupOf(conversation: Conversation, messageId: string) {
  for (const branch of conversation.branches) {
    const message = branch.messages.find((item) => item.id === messageId);
    if (message) return message.revisionGroupId || message.id;
  }
  return messageId;
}

/** The branches carrying a revision of the same message; more than one means the delete is a choice. */
export function branchesHoldingRevision(conversation: Conversation, groupId: string) {
  return conversation.branches.filter((branch) => branch.messages.some((message) => message.role === "user" && (message.revisionGroupId || message.id) === groupId)).map((branch) => branch.id);
}

function settle(conversation: Conversation, branches: Conversation["branches"], stamp: string): Conversation {
  // A branch emptied by the deletion carries nothing, and two branches that now hold the same
  // messages are one branch: keep the first of each and repoint whatever referred to the rest.
  const kept: Conversation["branches"] = [];
  const replacements = new Map<string, string>();
  for (const branch of branches) {
    const signature = branch.messages.map((message) => message.id).join(">");
    const twin = branch.messages.length ? kept.find((item) => item.messages.map((message) => message.id).join(">") === signature) : undefined;
    if (twin) { replacements.set(branch.id, twin.id); continue; }
    if (!branch.messages.length && branches.length > 1) { replacements.set(branch.id, ""); continue; }
    kept.push(branch);
  }
  const resolve = (branchId: string): string => {
    const seen = new Set<string>();
    let current = branchId;
    while (replacements.has(current) && !seen.has(current)) { seen.add(current); current = replacements.get(current) as string; }
    return kept.some((branch) => branch.id === current) ? current : "";
  };
  const survivors = kept.length ? kept : branches.slice(0, 1);
  const messageIds = new Set(survivors.flatMap((branch) => branch.messages.map((message) => message.id)));
  return {
    ...conversation,
    updatedAt: stamp,
    activeBranchId: resolve(conversation.activeBranchId) || survivors[0].id,
    branches: survivors.map((branch) => {
      const parentBranchId = branch.parentBranchId ? resolve(branch.parentBranchId) : "";
      const forkedFromMessageId = branch.forkedFromMessageId && messageIds.has(branch.forkedFromMessageId) ? branch.forkedFromMessageId : "";
      const { parentBranchId: _parent, forkedFromMessageId: _fork, ...rest } = branch;
      return { ...rest, ...(parentBranchId ? { parentBranchId } : {}), ...(forkedFromMessageId ? { forkedFromMessageId } : {}) };
    }),
  };
}

/** Removes the request and its answer from one branch, leaving other revisions untouched. */
export function deleteMessageFromBranch(conversation: Conversation, branchId: string, messageId: string, stamp: string): Conversation {
  const branches = conversation.branches.map((branch) => branch.id === branchId
    ? { ...branch, messages: removeUserMessagePair(branch.messages, messageId), updatedAt: stamp }
    : branch);
  return settle(conversation, branches, stamp);
}

/** Removes every revision of the message, and the answer that followed each one, from every branch. */
export function deleteMessageEverywhere(conversation: Conversation, groupId: string, stamp: string): Conversation {
  const branches = conversation.branches.map((branch) => {
    let messages = branch.messages;
    for (;;) {
      const target = messages.find((message) => message.role === "user" && (message.revisionGroupId || message.id) === groupId);
      if (!target) break;
      const next = removeUserMessagePair(messages, target.id);
      if (next === messages) break;
      messages = next;
    }
    return messages === branch.messages ? branch : { ...branch, messages, updatedAt: stamp };
  });
  return settle(conversation, branches, stamp);
}
