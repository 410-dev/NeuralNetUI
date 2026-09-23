import assert from "node:assert/strict";
import test from "node:test";
import { chatWaitLabel, withSlowProgress, progressFetch } from "./chat-progress.ts";

test('slow progress is emitted once and timers are cleared on success and failure', async () => {
  let count = 0;
  await withSlowProgress(() => new Promise(resolve => setTimeout(resolve, 20)), () => count++, 5);
  assert.equal(count, 1);
  await withSlowProgress(async () => {}, () => count++, 5);
  await assert.rejects(withSlowProgress(async () => { throw new Error('Failed'); }, () => count++, 5));
  await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(count, 1);
});
test('ambiguous inference failures are not automatically replayed', async () => {
  let requests = 0;
  const request: typeof fetch = async () => { requests++; throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }); };
  await assert.rejects(progressFetch('http://host', { method: 'POST' }, () => {}, 'preparing-response', request));
  assert.equal(requests, 1);
});
test('a server response timeout shows the wait message and can be cancelled', async () => {
  const controller = new AbortController(); const phases: string[] = [];
  const request: typeof fetch = async (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }));
  const pending = progressFetch('http://host', { signal: controller.signal }, phase => { phases.push(phase); if (phase === 'waiting-server') controller.abort(); }, 'loading-model', request, 5);
  await assert.rejects(pending, { name: 'AbortError' }); assert.ok(phases.includes('waiting-server'));
  assert.equal(chatWaitLabel('freeing-space', 'ko'), '모델을 로드할 공간을 확보중입니다');
});
test('server wait is not emitted before the response timeout, preserving prompt progress', async () => {
  const phases: string[] = [];
  const response = await progressFetch('http://host', {}, phase => phases.push(phase), 'processing-prompt', async () => {
    await new Promise(resolve => setTimeout(resolve, 8)); return new Response('ok');
  }, 40);
  assert.equal(response.status, 200);
  assert.deepEqual(phases, ['processing-prompt', 'processing-prompt']);
});
test('confirmed prompt processing stops an active server-wait timer', async () => {
  const prefill = new AbortController();
  let release!: () => void;
  const operation = new Promise<void>(resolve => { release = resolve; });
  let slow = 0;
  const pending = withSlowProgress(() => operation, () => slow++, 10, prefill.signal);
  prefill.abort();
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(slow, 0);
  release();
  await pending;
});
