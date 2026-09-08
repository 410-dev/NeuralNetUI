import assert from "node:assert/strict";
import test from "node:test";
import { chatEndpoint, modelsEndpoint, resolveConnectionModels } from "./connection-drivers.ts";
import type { ConnectionConfig, ModelConfig } from "./types.ts";

const model = (id: string, connectionId: string, name = id): ModelConfig => ({ id, name, sourceModel: id, description: "", isAlias: false, visible: true, reasoningSupported: false, reasoningPresets: [], connectionId });

test("driver endpoints distinguish OpenAI and LM Studio", () => {
  assert.equal(modelsEndpoint("openai", "http://host:8000/v1"), "http://host:8000/v1/models");
  assert.equal(modelsEndpoint("lmstudio", "http://localhost:1234"), "http://localhost:1234/api/v1/models");
  assert.equal(chatEndpoint("lmstudio", "http://localhost:1234/api/v1"), "http://localhost:1234/v1/chat/completions");
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
