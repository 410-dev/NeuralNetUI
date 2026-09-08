// Fresh test database and loopback inference server only. Run after npm run build.
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import Database from 'better-sqlite3';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const loaded = new Set(['a']); const calls = []; const holds = new Map();
let loadDelay = 150; let unloadDelay = 150;
const mock = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {}; calls.push({ url: req.url, body });
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/api/v1/models') return res.end(JSON.stringify({ models: ['a', 'b', 'c'].map(key => ({ key, type: 'llm', loaded_instances: loaded.has(key) ? [{ id: key }] : [], capabilities: { reasoning: { allowed_options: ['off', 'on'] } } })) }));
  if (req.url === '/v1/models') return res.end(JSON.stringify({ data: ['a', 'b', 'c'].map(id => ({ id })) }));
  if (req.url === '/api/v1/models/unload') { await delay(unloadDelay); loaded.delete(body.instance_id); return res.end('{}'); }
  if (req.url === '/api/v1/models/load') { await delay(loadDelay); loaded.add(body.model); return res.end(JSON.stringify({ status: 'loaded', instance_id: body.model })); }
  if (req.url !== '/v1/chat/completions') { res.statusCode = 404; return res.end('{}'); }
  res.setHeader('Content-Type', 'text/event-stream');
  const send = value => res.write(`data: ${JSON.stringify(value)}\n\n`);
  const content = body.messages.at(-1).content;
  send({ choices: [{ delta: { role: 'assistant' } }] });
  const finish = () => { send({ choices: [{ delta: { content: 'Done' }, finish_reason: 'stop' }] }); res.end('data: [DONE]\n\n'); };
  if (content.startsWith('hold')) { holds.set(content, finish); res.on('close', () => holds.delete(content)); }
  else if (content === 'slow' || content === 'QA') { const timer = setTimeout(finish, 6_500); res.on('close', () => clearTimeout(timer)); }
  else { await delay(50); finish(); }
});
mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
const mockUrl = `http://127.0.0.1:${mock.address().port}`;
const reservation = http.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
const data = await mkdtemp(path.join(os.tmpdir(), 'neuralnetui-residency-'));
const databasePath = path.join(data, 'test.sqlite3');
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { env: { ...process.env, NEURAL_CHAT_DATA_DIR: data, NEURAL_CHAT_DB_PATH: databasePath }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', chunk => { logs = (logs + chunk).slice(-12000); }); child.stderr.on('data', chunk => { logs = (logs + chunk).slice(-12000); });
const root = `http://127.0.0.1:${port}`; let cookie = ''; let sequence = 0;
async function api(route, method = 'GET', body) {
  return fetch(root + route, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
}
async function json(route, method, body) { const response = await api(route, method, body); const value = await response.json(); assert.ok(response.ok, JSON.stringify(value)); return value; }
async function until(predicate) { for (let i = 0; i < 600; i++) { if (predicate()) return; await delay(20); } throw new Error('Timed out waiting for test condition'); }
async function chat(modelId, content = 'test') {
  const id = `resident-${++sequence}`; const stamp = new Date().toISOString(); const message = { id: `${id}-user`, role: 'user', content, createdAt: stamp };
  await json('/api/conversations', 'POST', { id, title: content, modelId, activeBranchId: id, createdAt: stamp, updatedAt: stamp, branches: [{ id, name: 'Main', createdAt: stamp, updatedAt: stamp, messages: [message] }] });
  const first = await json('/api/chat', 'POST', { conversationId: id, branchId: id, assistantMessageId: `${id}-assistant`, modelId, reasoningPresetId: 'off', messages: [message] });
  const snapshots = [first]; const response = await api(`/api/chat/${id}`);
  const done = (async () => {
    const reader = response.body.getReader(); let buffer = '';
    try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; buffer += new TextDecoder().decode(chunk.value); const records = buffer.split('\n\n'); buffer = records.pop() || ''; for (const record of records) if (record.startsWith('data: {')) snapshots.push(JSON.parse(record.slice(6))); } }
    finally { reader.releaseLock(); }
    return snapshots.at(-1);
  })();
  return { id, snapshots, done, phase: phase => until(() => snapshots.some(item => item.waitPhase === phase)) };
}
let config;
async function settings(limit, policy = 'capacity', driver = 'lmstudio') {
  config = await json('/api/config');
  config.connections[0] = { ...config.connections[0], driver, baseUrl: driver === 'openai' ? `${mockUrl}/v1` : mockUrl, maxResidentModels: limit, modelWaitPolicy: policy };
  config = await json('/api/config', 'PUT', config);
}
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(root + '/api/auth/status')).ok) break; } catch {} await delay(100); }
  const setup = await api('/api/auth/setup', 'POST', { username: 'residency', displayName: 'Residency QA', password: 'LocalResidency-20260908' });
  assert.equal(setup.status, 201); cookie = setup.headers.get('set-cookie').split(';')[0];
  config = await json('/api/config');
  const models = ['a', 'b', 'c'].map(id => ({ id, sourceModel: id, name: `Model ${id.toUpperCase()}`, connectionId: 'server', isAlias: false, visible: true, reasoningSupported: true, reasoningEfforts: ['off', 'on'], reasoningPresets: [] }));
  config.connections = [{ id: 'server', name: 'Residency test server', driver: 'lmstudio', baseUrl: mockUrl, apiKey: '', maxResidentModels: 1, modelWaitPolicy: 'capacity', models }];
  config.models = [...models, { ...models[0], id: 'alias', name: 'Alias A', isAlias: true }]; config.preferences.language = 'ko'; config.preferences.onDemand = false;
  config = await json('/api/config', 'PUT', config);
  for (const invalid of [-1, 1.5, 129]) { const candidate = structuredClone(config); candidate.connections[0].maxResidentModels = invalid; assert.equal((await api('/api/config', 'PUT', candidate)).status, 400); }
  const active = await chat('a', 'hold-a'); await until(() => holds.has('hold-a'));
  const alias = await chat('alias', 'hold-alias'); await until(() => holds.has('hold-alias'));
  const queued = await chat('b'); await queued.phase('waiting-session');
  assert.equal(calls.filter(call => call.url.endsWith('/unload')).length, 0);
  holds.get('hold-a')(); await active.done; await delay(150); assert.equal(calls.filter(call => call.url.endsWith('/unload')).length, 0);
  holds.get('hold-alias')(); await alias.done;
  assert.equal((await queued.done).status, 'completed');
  for (const phase of ['waiting-session', 'freeing-space', 'loading-model', 'preparing-response']) assert.ok(queued.snapshots.some(item => item.waitPhase === phase), phase);
  assert.deepEqual([...loaded], ['b']); assert.equal(queued.snapshots.at(-1).waitPhase, undefined);
  console.log('PASS: capacity, alias activity protection, automatic loading with on-demand off, and phase cleanup');

  await settings(2, 'serial'); loaded.add('a');
  const serial = await chat('b', 'hold-serial'); await until(() => holds.has('hold-serial'));
  const serialNext = await chat('a'); await serialNext.phase('waiting-session');
  const cancelled = await chat('c'); await cancelled.phase('waiting-session');
  await api(`/api/chat/${cancelled.id}`, 'DELETE'); assert.equal((await cancelled.done).status, 'stopped');
  holds.get('hold-serial')(); await serial.done; assert.equal((await serialNext.done).status, 'completed');
  assert.ok(!calls.some(call => call.url.endsWith('/load') && call.body.model === 'c'));
  console.log('PASS: selectable serial policy and queue cancellation');

  await settings(2); await (await chat('a')).done; await (await chat('a')).done;
  const replacement = await chat('c'); assert.equal((await replacement.done).status, 'completed');
  assert.ok(loaded.has('a')); assert.ok(loaded.has('c')); assert.ok(!loaded.has('b'));
  const usageDb = new Database(databasePath, { readonly: true }); const usage = usageDb.prepare('SELECT * FROM model_usage').all(); usageDb.close();
  assert.ok(usage.find(row => row.model_id === 'a').use_count > usage.find(row => row.model_id === 'b').use_count);
  console.log('PASS: persisted LFU counts select the least-used model');

  await settings(2, 'capacity', 'openai');
  const compatible = await chat('b'); assert.equal((await compatible.done).status, 'completed'); assert.ok(loaded.has('b'));
  const slow = await chat('b', 'slow'); await slow.phase('waiting-server'); assert.equal((await slow.done).status, 'completed'); assert.equal(slow.snapshots.at(-1).waitPhase, undefined);
  console.log('PASS: LM Studio management through OpenAI-compatible connections and the five-second server wait');

  const offline = http.createServer(); offline.listen(0, '127.0.0.1'); await once(offline, 'listening'); const offlinePort = offline.address().port; await new Promise(resolve => offline.close(resolve));
  config = await json('/api/config'); config.connections[0].baseUrl = `http://127.0.0.1:${offlinePort}`; config = await json('/api/config', 'PUT', config);
  const disconnected = await chat('b'); await disconnected.phase('waiting-server'); await api(`/api/chat/${disconnected.id}`, 'DELETE'); assert.equal((await disconnected.done).status, 'stopped');
  await settings(1); loaded.clear(); loaded.add('a');
  console.log(`Integration checks passed. Test data: ${data}`);
  if (process.argv.includes('--keep-open')) {
    loadDelay = 1_500; unloadDelay = 1_500;
    console.log(`QA_URL=${root}\nQA_USER=residency\nQA_PASSWORD=LocalResidency-20260908`);
    await new Promise(() => {});
  }
} catch (error) { console.error(logs); throw error; }
finally { child.kill(); mock.closeAllConnections(); mock.close(); }
