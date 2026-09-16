import assert from "node:assert/strict";
import test from "node:test";
import { branchesHoldingRevision, deleteMessageEverywhere, deleteMessageFromBranch, revisionGroupOf } from "./branch-deletion.ts";
import { duplicateConversation } from "./conversation-duplicate.ts";
import type { ChatBranch, Conversation, StoredMessage } from "./types.ts";

const stamp = "2026-09-16T00:00:00.000Z";
const later = "2026-09-16T01:00:00.000Z";
const message = (id: string, role: StoredMessage["role"], revisionGroupId?: string): StoredMessage =>
  ({ id, role, content: id, createdAt: stamp, ...(revisionGroupId ? { revisionGroupId } : {}) });
const branch = (id: string, messages: StoredMessage[], extra: Partial<ChatBranch> = {}): ChatBranch =>
  ({ id, name: id, messages, createdAt: stamp, updatedAt: stamp, ...extra });

// Editing "u2" forks a second branch, so the same request exists twice under one revision group.
const forked = (): Conversation => ({
  id: "chat", title: "Chat", modelId: "model", activeBranchId: "edited", createdAt: stamp, updatedAt: stamp,
  branches: [
    branch("main", [message("u1", "user"), message("a1", "assistant"), message("u2", "user"), message("a2", "assistant")]),
    branch("edited", [message("u1", "user"), message("a1", "assistant"), message("u2-edit", "user", "u2"), message("a3", "assistant")],
      { parentBranchId: "main", forkedFromMessageId: "u2" }),
  ],
});

test("a revision group names every branch that holds one version of the request", () => {
  const conversation = forked();
  assert.equal(revisionGroupOf(conversation, "u2-edit"), "u2");
  assert.deepEqual(branchesHoldingRevision(conversation, "u2"), ["main", "edited"]);
  assert.deepEqual(branchesHoldingRevision(conversation, revisionGroupOf(conversation, "u1")), ["main", "edited"]);
});

test("deleting in one branch keeps the other revision and its branch", () => {
  const next = deleteMessageFromBranch(forked(), "edited", "u2-edit", later);
  assert.deepEqual(next.branches.map((item) => item.id), ["main", "edited"]);
  assert.deepEqual(next.branches[1].messages.map((item) => item.id), ["u1", "a1"]);
  assert.deepEqual(next.branches[0].messages.map((item) => item.id), ["u1", "a1", "u2", "a2"]);
  assert.equal(next.activeBranchId, "edited");
});

test("deleting every revision removes each request with its own answer and folds the duplicate branch away", () => {
  const next = deleteMessageEverywhere(forked(), "u2", later);
  assert.deepEqual(next.branches.map((item) => item.id), ["main"]);
  assert.deepEqual(next.branches[0].messages.map((item) => item.id), ["u1", "a1"]);
  assert.equal(next.activeBranchId, "main");
  assert.equal(next.branches[0].forkedFromMessageId, undefined);
});

test("deleting the only message leaves one empty branch rather than a conversation without branches", () => {
  const conversation: Conversation = {
    id: "chat", title: "Chat", modelId: "model", activeBranchId: "main", createdAt: stamp, updatedAt: stamp,
    branches: [branch("main", [message("u1", "user"), message("a1", "assistant")])],
  };
  const next = deleteMessageEverywhere(conversation, "u1", later);
  assert.equal(next.branches.length, 1);
  assert.deepEqual(next.branches[0].messages, []);
  assert.equal(next.activeBranchId, "main");
});

test("a repeated revision in one branch is removed with the answer that followed each copy", () => {
  const conversation: Conversation = {
    id: "chat", title: "Chat", modelId: "model", activeBranchId: "main", createdAt: stamp, updatedAt: stamp,
    branches: [branch("main", [message("u1", "user"), message("a1", "assistant"), message("u1-again", "user", "u1"), message("a2", "assistant"), message("u2", "user")])],
  };
  const next = deleteMessageEverywhere(conversation, "u1", later);
  assert.deepEqual(next.branches[0].messages.map((item) => item.id), ["u2"]);
});

test("a duplicated chat keeps every branch while renaming all shared identifiers", () => {
  const source = forked();
  let counter = 0;
  const copy = duplicateConversation(source, { id: "copy", title: "Chat copy", stamp: later, newId: (kind) => `${kind}-${++counter}` });
  assert.equal(copy.id, "copy");
  assert.equal(copy.title, "Chat copy");
  assert.equal(copy.temporary, false);
  assert.equal(copy.createdAt, later);
  assert.deepEqual(copy.branches.map((item) => item.messages.length), [4, 4]);
  const ids = copy.branches.flatMap((item) => [item.id, ...item.messages.map((entry) => entry.id)]);
  const sourceIds = source.branches.flatMap((item) => [item.id, ...item.messages.map((entry) => entry.id)]);
  assert.equal(ids.some((value) => sourceIds.includes(value)), false);
  // One message shared by both branches must stay one message in the copy.
  assert.equal(copy.branches[0].messages[0].id, copy.branches[1].messages[0].id);
  assert.equal(copy.activeBranchId, copy.branches[1].id);
  assert.equal(copy.branches[1].parentBranchId, copy.branches[0].id);
  assert.equal(copy.branches[1].forkedFromMessageId, copy.branches[0].messages[2].id);
  assert.equal(copy.branches[1].messages[2].revisionGroupId, copy.branches[0].messages[2].id);
  // The copy still answers the revision questions the original does.
  assert.deepEqual(branchesHoldingRevision(copy, revisionGroupOf(copy, copy.branches[1].messages[2].id)), copy.branches.map((item) => item.id));
});
