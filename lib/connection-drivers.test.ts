import assert from "node:assert/strict";
import test from "node:test";
import { chatEndpoint, chatHeaders, modelsEndpoint, resolveConnectionModels } from "./connection-drivers.ts";
import type { ConnectionConfig, ModelConfig } from "./types.ts";

const model = (id: string, connectionId: string, name = id): ModelConfig => ({ id, name, sourceModel: id, description: "", isAlias: false, visible: true, reasoningSupported: false, reasoningPresets: [], connectionId });

test("driver endpoints distinguish OpenAI, LM Studio, and NNUI Server", () => {
  assert.equal(modelsEndpoint("openai", "http://host:8000/v1"), "http://host:8000/v1/models");
  assert.equal(modelsEndpoint("lmstudio", "http://localhost:1234"), "http://localhost:1234/api/v1/models");
  assert.equal(chatEndpoint("lmstudio", "http://localhost:1234/api/v1"), "http://localhost:1234/v1/chat/completions");
  assert.equal(modelsEndpoint("nnui", "http://localhost:11435"), "http://localhost:11435/v1/models");
  assert.equal(modelsEndpoint("nnui", "http://localhost:11435/v1"), "http://localhost:11435/v1/models");
  assert.equal(chatEndpoint("nnui", "http://localhost:11435"), "http://localhost:11435/v1/chat/completions");
});

test("only NNUI chat requests carry the stable server session header", () => {
  const base = { apiKey: "secret", clearApiKey: false };
  assert.equal(chatHeaders({ ...base, driver: "nnui" }, "", "conversation-42")["X-Llama-NNUI-Session-Id"], "conversation-42");
  assert.equal(chatHeaders({ ...base, driver: "openai" }, "", "conversation-42")["X-Llama-NNUI-Session-Id"], undefined);
  assert.equal(chatHeaders({ ...base, driver: "lmstudio" }, "", "conversation-42")["X-Llama-NNUI-Session-Id"], undefined);
});

test("connection order resolves duplicate model identifiers", () => {
  const connections: ConnectionConfig[] = [
    { id: "top", name: "Top", driver: "openai", baseUrl: "http://top/v1", apiKey: "", models: [model("same", "top", "Top model")] },
    { id: "lower", name: "Lower", driver: "lmstudio", baseUrl: "http://lower", apiKey: "", models: [model("same", "lower", "Lower model"), model("unique", "lower")] },
  ];
  assert.deepEqual(resolveConnectionModels(connections).map(({ name, connectionId }) => [name, connectionId]), [["Top model", "top"], ["unique", "lower"]]);
  assert.equal(resolveConnectionModels(connections.reverse())[0].name, "Lower model");
});

test("saved model order remains independent from connection priority", () => {
  const connections: ConnectionConfig[] = [
    { id: "top", name: "Top", driver: "openai", baseUrl: "http://top/v1", apiKey: "", models: [model("a", "top"), model("b", "top")] },
    { id: "lower", name: "Lower", driver: "lmstudio", baseUrl: "http://lower", apiKey: "", models: [model("c", "lower")] },
  ];
  assert.deepEqual(resolveConnectionModels(connections, [], ["c", "a", "b"]).map(({ id }) => id), ["c", "a", "b"]);
});

test("removing a connection immediately drops its models and reveals lower-priority duplicates", () => {
  const top: ConnectionConfig = { id: "top", name: "Top", driver: "openai", baseUrl: "http://top/v1", apiKey: "", models: [model("same", "top", "Top model"), model("removed", "top")] };
  const lower: ConnectionConfig = { id: "lower", name: "Lower", driver: "lmstudio", baseUrl: "http://lower", apiKey: "", models: [model("same", "lower", "Lower model"), model("kept", "lower")] };
  const before = resolveConnectionModels([top, lower]);
  const after = resolveConnectionModels([lower], [], before.map(item => item.id));
  assert.deepEqual(after.map(({ name, connectionId }) => [name, connectionId]), [["Lower model", "lower"], ["kept", "lower"]]);
  assert.equal(after.some(item => item.id === "removed"), false);
});
