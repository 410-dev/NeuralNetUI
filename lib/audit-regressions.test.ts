import assert from "node:assert/strict";
import test from "node:test";
import { connectionForModel, connectionHeaders, reconcileConnectionEdits } from "./connection-drivers.ts";
import { inferApiContextWindowTokens } from "./model-context.ts";
import { mergeModelPresets, reasoningEffort } from "./model-edits.ts";
import { restoreToolHistory, settlePendingTools } from "./conversation-messages.ts";
import { readSsePayload } from "./stream-protocol.ts";
import { saveConversationRequest } from "./client-persistence.ts";
import { registerChatDisposal, discardChatJobs } from "./chat-disposal.ts";
import type { ModelConfig, StoredMessage } from "./types.ts";

const model: ModelConfig = { id: "a", sourceModel: "a", name: "A", isAlias: false, visible: true, reasoningSupported: true, connectionId: "A", reasoningPresets: [{ id: "high", name: "High", kind: "builtin", effort: "high" }, { id: "private", name: "Private", kind: "custom", ownerId: "other" }] };
const connections = [{ id: "A", name: "A", driver: "lmstudio" as const, baseUrl: "http://localhost:1234", apiKey: "", models: [model] }, { id: "B", name: "B", driver: "lmstudio" as const, baseUrl: "http://localhost:1235", apiKey: "", models: [{ ...model, id: "b", sourceModel: "b", connectionId: "B" }] }];

test("ordinary saves preserve builtin and other users' presets, including colliding IDs", () => {
  const result = mergeModelPresets(model, { ...model, reasoningPresets: [{ id: "high", name: "spoof", kind: "custom" }, { id: "own", name: "Own", kind: "custom" }] }, "user", false);
  assert.equal(result.reasoningPresets.find(p => p.id === "high")?.kind, "builtin");
  assert.equal(result.reasoningPresets.find(p => p.id === "private")?.ownerId, "other");
  assert.equal(result.reasoningPresets.find(p => p.id === "own")?.ownerId, "user");
});
test("stale alias connection is resolved against the new base", () => {
  assert.equal(connectionForModel(connections, { ...model, id: "alias", sourceModel: "b", isAlias: true })?.id, "B");
});
test("connection edits preserve model and preset drafts", () => {
  const edited = { ...model, name: "Edited", reasoningPresets: [] };
  const result = reconcileConnectionEdits(connections, [edited]);
  assert.equal(result[0].models[0].name, "Edited");
  assert.deepEqual(result[0].models[0].reasoningPresets, []);
});
test("loaded context wins over the model maximum and ignores invalid instances", () => {
  assert.equal(inferApiContextWindowTokens({ max_context_length: 262144, loaded_instances: [{ config: { context_length: 4096 } }, null, { config: { context_length: -1 } }] }), 4096);
});
test("disabled reasoning and unsupported efforts are omitted", () => {
  assert.equal(reasoningEffort({ ...model, reasoningSupported: false }, model.reasoningPresets[0]), undefined);
  assert.equal(reasoningEffort({ ...model, reasoningEfforts: ["off", "on"] }, model.reasoningPresets[0]), undefined);
  assert.equal(reasoningEffort(model, model.reasoningPresets[0]), "high");
});
test("cleared API keys do not reuse environment fallback", () => {
  assert.equal(connectionHeaders({ apiKey: "", clearApiKey: true }, "fallback").Authorization, undefined);
});
test("tool answers are reconstructed for subsequent turns and pending tools settle", () => {
  const message: StoredMessage = { id: "assistant", role: "assistant", content: "Saved", createdAt: "now", toolEvents: [{ id: "choice", name: "ask_multiple_choice", status: "completed", startedAt: "now", arguments: { question: "Color?" }, result: { answers: [{ selections: ["Blue"] }] } }] };
  const history = restoreToolHistory(message);
  assert.equal(history[0].role, "assistant");
  assert.equal(history[1].role, "tool");
  assert.match(String(history[1].content), /Blue/);
  const pending = { ...message, toolEvents: message.toolEvents!.map(e => ({ ...e, status: "waiting" as const })) };
  assert.equal(settlePendingTools([pending])[0].toolEvents![0].status, "error");
});
test("stream payload errors and malformed JSON propagate", () => {
  assert.throws(() => readSsePayload('{"error":{"message":"Context exceeded"}}'), /Context exceeded/);
  assert.throws(() => readSsePayload('{bad'), /Invalid/);
  assert.equal(readSsePayload('[DONE]'), "done");
});

test("failed saves propagate HTTP and network errors instead of reporting success", async () => {
  const conversation = { id: "test" } as import("./types.ts").Conversation;
  await assert.rejects(saveConversationRequest(conversation, false, (async () => Response.json({ error: "Disk full" }, { status: 500 })) as typeof fetch), /Disk full/);
  await assert.rejects(saveConversationRequest(conversation, true, (async () => { throw new Error("Offline"); }) as typeof fetch), /Offline/);
});

test("job disposal is scoped to the owner and old cleanup cannot unregister replacements", () => {
  const removed: string[] = [];
  const oldCleanup = registerChatDisposal("chat", "u", () => removed.push("old"));
  registerChatDisposal("chat", "u", () => removed.push("new")); oldCleanup();
  discardChatJobs("other", "chat"); assert.deepEqual(removed, []);
  discardChatJobs("u", "chat"); assert.deepEqual(removed, ["new"]);
  discardChatJobs("u", "chat"); assert.deepEqual(removed, ["new"]);
});
