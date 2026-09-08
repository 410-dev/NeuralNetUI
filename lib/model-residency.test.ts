import assert from "node:assert/strict";
import test from "node:test";
import { ModelBusyError, ModelResidencyManager, type ResidencyAdapter, type ResidentModel } from "./model-residency.ts";

function fixture(initial: string[] = ['a']) {
  const models = new Set(initial); const calls: string[] = []; const usage = new Map<string, { count: number; lastUsed: number }>();
  const adapter: ResidencyAdapter = {
    async list() { return [...models].map(id => ({ id, identifiers: [id], instanceIds: [id] })); },
    async unload(model) { calls.push(`unload:${model.id}`); models.delete(model.id); },
    async load(id) { calls.push(`load:${id}`); models.add(id); },
  };
  const manager = new ModelResidencyManager({ get: (_server, id) => usage.get(id) || { count: 0, lastUsed: 0 }, record: (_server, id) => usage.set(id, { count: (usage.get(id)?.count || 0) + 1, lastUsed: Date.now() }) });
  const acquire = (id: string, options = {}) => manager.acquire({ server: 'server', model: id, limit: 1, policy: 'capacity', adapter, signal: new AbortController().signal, ...options });
  return { models, calls, usage, adapter, manager, acquire };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 10));

test('LFU eviction prefers least-used idle model and breaks ties by oldest use', async () => {
  const f = fixture(['a', 'b']); f.usage.set('a', { count: 3, lastUsed: 1 }); f.usage.set('b', { count: 1, lastUsed: 9 });
  const release = await f.acquire('c', { limit: 2 }); release();
  assert.deepEqual(f.calls, ['unload:b', 'load:c']);
  assert.equal(f.usage.get('c')?.count, 1);
});
test('active models are protected; queued requests resume when their lease ends', async () => {
  const f = fixture(); const phases: string[] = [];
  const releaseA = await f.acquire('a');
  const pending = f.acquire('b', { onPhase: (phase: string) => phases.push(phase) });
  await tick(); assert.deepEqual(f.calls, []); assert.ok(phases.includes('waiting-session'));
  releaseA(); const releaseB = await pending; releaseB();
  assert.deepEqual(f.calls, ['unload:a', 'load:b']);
});
test('capacity mode admits the same loaded model concurrently; serial mode waits', async () => {
  const f = fixture(); const first = await f.acquire('a'); const second = await f.acquire('a');
  let admitted = false; const third = f.acquire('a', { policy: 'serial' }).then(release => { admitted = true; return release; });
  await tick(); assert.equal(admitted, false); first(); await tick(); assert.equal(admitted, false);
  second(); (await third)(); assert.deepEqual(f.calls, []);
});
test('parallel cold loads cannot exceed the limit; cancellation removes a queued request', async () => {
  const f = fixture([]); const controller = new AbortController();
  const first = await f.acquire('a'); const pending = f.acquire('b', { signal: controller.signal });
  await tick(); controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
  assert.deepEqual([...f.models], ['a']); first();
  (await f.acquire('c'))(); assert.deepEqual([...f.models], ['c']);
});
test('load failures release the server lock and never leak an active reservation', async () => {
  const f = fixture([]); const load = f.adapter.load;
  f.adapter.load = async () => { throw new Error('Load failed'); };
  await assert.rejects(f.acquire('a'), /Load failed/); f.adapter.load = load;
  (await f.acquire('b'))(); assert.deepEqual([...f.models], ['b']);
});
test('different servers are independent and aliases share native model protection', async () => {
  const f = fixture(); const list = f.adapter.list;
  f.adapter.list = async signal => (await list(signal)).map(model => ({ ...model, identifiers: [model.id, 'alias-a'] }));
  const release = await f.acquire('alias-a');
  const controller = new AbortController(); const waiting = f.acquire('b', { signal: controller.signal });
  (await f.acquire('b', { server: 'other', adapter: { ...f.adapter, async list() { return [{ id: "b", identifiers: ["b"], instanceIds: ["b"] }]; }, async load() {} } }))();
  controller.abort(); await assert.rejects(waiting, { name: 'AbortError' }); release();
  assert.deepEqual(f.calls, []);
});
test('duplicate loaded instances count toward capacity and are evicted as a model group', async () => {
  const f = fixture(); f.adapter.list = async () => [...f.models].map(id => ({ id, identifiers: [id], instanceIds: id === 'a' ? ['a-1', 'a-2'] : [id] } satisfies ResidentModel));
  (await f.acquire('b', { limit: 2 }))(); assert.deepEqual(f.calls, ['unload:a', 'load:b']);
});

test('cancelling a dispatched load retains the lock until the server finishes', async () => {
  const f = fixture([]); let finish!: () => void; const load = f.adapter.load;
  f.adapter.load = async (id, signal) => { if (id === 'a') await new Promise<void>(resolve => { finish = resolve; }); await load(id, signal); };
  const controller = new AbortController(); const first = f.acquire('a', { signal: controller.signal });
  await tick(); controller.abort(); await assert.rejects(first, { name: 'AbortError' });
  const second = f.acquire('b'); await tick(); assert.deepEqual(f.calls, []);
  finish(); (await second)(); assert.deepEqual(f.calls, ['load:a', 'unload:a', 'load:b']);
});

test('a busy unload response waits instead of failing or loading over capacity', async () => {
  const f = fixture(); const controller = new AbortController(); const phases: string[] = [];
  f.adapter.unload = async () => { throw new ModelBusyError('busy'); };
  const pending = f.acquire('b', { signal: controller.signal, onPhase: (phase: string) => phases.push(phase) });
  await tick(); assert.ok(phases.includes('waiting-session')); assert.deepEqual(f.calls, []);
  controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
});
