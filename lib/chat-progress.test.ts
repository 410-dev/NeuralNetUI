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
test('connection refusal shows the server wait message and can be cancelled', async () => {
  const controller = new AbortController(); const phases: string[] = [];
  const request: typeof fetch = async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }); };
  const pending = progressFetch('http://host', { signal: controller.signal }, phase => { phases.push(phase); if (phase === 'waiting-server') controller.abort(); }, 'loading-model', request);
  await assert.rejects(pending, { name: 'AbortError' }); assert.ok(phases.includes('waiting-server'));
  assert.equal(chatWaitLabel('freeing-space', 'ko'), '모델을 로드할 공간을 확보중입니다');
});
