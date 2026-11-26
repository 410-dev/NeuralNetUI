import assert from "node:assert/strict";
import test from "node:test";
import { createResidencyAdapter, nativeResidents, legacyResidents } from "./residency-adapter.ts";

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

test('OpenAI compatible servers without management endpoints are admitted unmanaged', async () => {
  const { ModelResidencyManager, ModelManagementUnavailableError } = await import('./model-residency.ts');
  let calls = 0;
  const request: typeof fetch = async () => { calls++; return new Response('{"error": "no such endpoint /api/inference/status"}', { status: 404 }); };
  const connection = { id: 'a', name: 'A', driver: 'openai' as const, baseUrl: 'http://localhost:8000/v1', apiKey: '', models: [] };
  const adapter = createResidencyAdapter(connection, {}, undefined, () => {}, request);
  const signal = new AbortController().signal;
  await assert.rejects(adapter.list(signal), ModelManagementUnavailableError);
  const before = calls; await assert.rejects(adapter.load('a', signal), ModelManagementUnavailableError); assert.equal(calls, before);
  const manager = new ModelResidencyManager({ get: () => ({ count: 0, lastUsed: 0 }), record: () => undefined });
  const release = await manager.acquire({ server: 's', model: 'a', limit: 1, policy: 'capacity', adapter: createResidencyAdapter(connection, {}, undefined, () => {}, request), signal });
  release();
});
test('LM Studio management failures remain fatal', async () => {
  const request: typeof fetch = async () => new Response('down', { status: 500 });
  const connection = { id: 'a', name: 'A', driver: 'lmstudio' as const, baseUrl: 'http://localhost:1234', apiKey: '', models: [] };
  await assert.rejects(createResidencyAdapter(connection, {}, undefined, () => {}, request).list(new AbortController().signal), /Model management failed \(500\)/);
});
