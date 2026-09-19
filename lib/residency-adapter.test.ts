import assert from "node:assert/strict";
import test from "node:test";
import { createResidencyAdapter, nativeResidents, legacyResidents, nnuiResidents } from "./residency-adapter.ts";

test('native inventory preserves keys, variants, and all loaded instance IDs', () => {
  const result = nativeResidents({ models: [{ key: 'a', type: 'llm', variants: ['a@q4'], loaded_instances: [{ id: 'a-1' }, { id: 'a-2', busy: true }] }, { key: 'embedding', type: 'embedding', loaded_instances: [{ id: 'embedding' }] }] });
  assert.equal(result.length, 1); assert.deepEqual(result[0].instanceIds, ['a-1', 'a-2']); assert.ok(result[0].identifiers.includes('a@q4')); assert.equal(result[0].busy, true);
  assert.throws(() => nativeResidents({ models: [{ key: 'a', loaded_instances: [{}] }] }), /identifier/);
  assert.throws(() => legacyResidents({}), /model-management API/);
});
test('OpenAI compatible LM Studio uses native load/unload and legacy fallback remains supported', async () => {
  const calls: Array<{ url: string; body?: string }> = [];
  const request: typeof fetch = async (input, init) => { calls.push({ url: String(input), body: init?.body as string }); return Response.json(String(input).endsWith('/models') ? { models: [] } : {}); };
  const connection = { id: 'a', name: 'A', driver: 'openai' as const, baseUrl: 'http://localhost:1234/v1', apiKey: '', models: [] };
  const adapter = createResidencyAdapter(connection, {}, 4096, () => {}, request); const signal = new AbortController().signal;
  await adapter.list(signal); await adapter.load('a', signal); await adapter.unload({ id: 'a', identifiers: ['a'], instanceIds: ['a-1'] }, signal);
  assert.deepEqual(JSON.parse(calls[1].body!), { model: 'a', context_length: 4096 });
  assert.deepEqual(JSON.parse(calls[2].body!), { instance_id: 'a-1' });
  const legacy: typeof fetch = async input => String(input).endsWith('/api/v1/models') ? new Response('', { status: 404 }) : Response.json({ loaded: ['a', 'b'] });
  assert.equal((await createResidencyAdapter(connection, {}, undefined, () => {}, legacy).list(signal)).length, 2);
});

test("NNUI inventory and lifecycle use the documented control-plane endpoints", async () => {
  const residents = nnuiResidents({ models: [
    { id: "idle", state: "unloaded", active_requests: 0 },
    { id: "ready", state: "ready", active_requests: 0, settings: { aliases: ["main"] } },
    { id: "busy", state: "loading", active_requests: 1 },
  ] });
  assert.deepEqual(residents.map(item => item.id), ["ready", "busy"]);
  assert.ok(residents[0].identifiers.includes("main"));
  assert.equal(residents[1].busy, true);

  const calls: Array<{ url: string; method?: string }> = [];
  const request: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), method: init?.method });
    return String(input).endsWith("/status") ? Response.json({ models: [{ id: "ready", state: "ready", active_requests: 0 }] }) : Response.json({ id: "ready", state: "ready" });
  };
  const connection = { id: "nnui", name: "NNUI", driver: "nnui" as const, baseUrl: "http://localhost:11435/v1", apiKey: "", models: [] };
  const adapter = createResidencyAdapter(connection, {}, undefined, () => {}, request); const signal = new AbortController().signal;
  assert.equal((await adapter.list(signal))[0].id, "ready");
  await adapter.load("model/a", signal);
  await adapter.unload({ id: "model/a", identifiers: ["model/a"], instanceIds: ["model/a"] }, signal);
  assert.deepEqual(calls, [
    { url: "http://localhost:11435/api/models/status", method: undefined },
    { url: "http://localhost:11435/api/models/model%2Fa/load", method: "POST" },
    { url: "http://localhost:11435/api/models/model%2Fa/unload", method: "POST" },
  ]);
});
