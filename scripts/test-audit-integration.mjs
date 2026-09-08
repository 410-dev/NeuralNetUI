// Run after npm run build. Uses only a fresh temporary DB and loopback mock server.
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

const requests = [];
const mock = http.createServer(async (req, res) => {
  let text = ''; for await (const part of req) text += part;
  const body = text ? JSON.parse(text) : {};
  requests.push({ url: req.url, body, authorization: req.headers.authorization });
  if (req.url.endsWith('/models')) return res.end(JSON.stringify({ models: ['model-a', 'model-b'].map(key => ({ key, type: 'llm', max_context_length: 262144, loaded_instances: [{ id: key, config: { context_length: 4096 } }] })) }));
  if (!req.url.endsWith('/chat/completions')) return res.end('{}');
  res.setHeader('Content-Type', 'text/event-stream');
  const send = value => res.write(`data: ${JSON.stringify(value)}\n\n`);
  const content = body.messages.at(-1)?.content;
  if (content === 'error') { send({ error: { message: 'Context exceeded' } }); return res.end('data: [DONE]\n\n'); }
  if (content === 'malformed') return res.end('data: {bad\n\n');
  if (content === 'truncated') { send({ choices: [{ delta: { content: 'Partial' } }] }); return res.end(); }
  if (content === 'choice') {
    send({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'choice-call', type: 'function', function: { name: 'ask_multiple_choice', arguments: JSON.stringify({ questions: [{ question: 'Color?', type: 'single_select', options: ['Blue', 'Red'] }] }) } }] }, finish_reason: 'tool_calls' }] });
    return res.end('data: [DONE]\n\n');
  }
  send({ choices: [{ delta: { content: 'Response' } }] });
  const finish = () => { send({ choices: [{ delta: {}, finish_reason: 'stop' }] }); res.end('data: [DONE]\n\n'); };
  if (content === 'slow') { const timer = setTimeout(finish, 800); res.on('close', () => clearTimeout(timer)); }
  else finish();
});
mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
const mockUrl = `http://127.0.0.1:${mock.address().port}`;
const reservation = http.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
const data = await mkdtemp(path.join(os.tmpdir(), 'neuralnetui-regression-'));
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { env: { ...process.env, NEURAL_CHAT_DATA_DIR: data, NEURAL_CHAT_DB_PATH: path.join(data, 'test.sqlite3') }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; server.stdout.on('data', chunk => { logs = (logs + chunk).slice(-16000); }); server.stderr.on('data', chunk => { logs = (logs + chunk).slice(-16000); });
const root = `http://127.0.0.1:${port}`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function api(route, method = 'GET', body, cookie = adminCookie) {
  return fetch(root + route, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
}
async function json(route, method = 'GET', body, cookie) { const r = await api(route, method, body, cookie); const value = await r.json(); assert.ok(r.ok, `${route}: ${JSON.stringify(value)}`); return value; }
let adminCookie = ''; let sequence = 0;
const stamp = () => new Date().toISOString();
async function conversation(content, messages) {
  const id = `regression-${++sequence}`; const branchId = `${id}-branch`;
  const record = { id, title: content, modelId: 'model-a', activeBranchId: branchId, createdAt: stamp(), updatedAt: stamp(), branches: [{ id: branchId, name: 'Main', createdAt: stamp(), updatedAt: stamp(), messages: messages || [{ id: `${id}-user`, role: 'user', content, createdAt: stamp() }] }] };
  return json('/api/conversations', 'POST', record);
}
async function start(record, extra = {}) { return json('/api/chat', 'POST', { conversationId: record.id, branchId: record.activeBranchId, assistantMessageId: `${record.id}-assistant-${Date.now()}`, modelId: record.modelId, reasoningPresetId: 'high', messages: record.branches[0].messages, ...extra }); }
async function terminal(record) {
  const response = await api(`/api/chat/${record.id}`); assert.equal(response.status, 200);
  const text = await response.text();
  const snapshots = text.split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)));
  return snapshots.at(-1);
}
async function waitStatus(record, status) {
  const response = await api(`/api/chat/${record.id}`); const reader = response.body.getReader(); let buffer = '';
  try { while (!buffer.includes(`"status":"${status}"`)) { const result = await reader.read(); assert.equal(result.done, false); buffer += new TextDecoder().decode(result.value); } }
  finally { await reader.cancel(); }
}
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(root + '/api/auth/status')).ok) break; } catch {} await delay(100); }
  const setup = await api('/api/auth/setup', 'POST', { username: 'audit', displayName: 'Audit', password: 'LocalAudit-20260908' });
  assert.equal(setup.status, 201); adminCookie = setup.headers.get('set-cookie').split(';')[0];
  let config = await json('/api/config');
  const model = (id, connectionId) => ({ id, sourceModel: id, name: id, connectionId, visible: true, isAlias: false, reasoningSupported: false, reasoningPresets: [{ id: 'high', name: 'High', kind: 'builtin', effort: 'high' }] });
  config.connections = ['a', 'b'].map(id => ({ id, name: `Server ${id}`, driver: 'lmstudio', baseUrl: id === 'a' ? mockUrl : `${mockUrl}/second`, apiKey: '', models: [model(`model-${id}`, id)] }));
  config.models = config.connections.flatMap(c => c.models); config.preferences.language = 'ko';
  config = await json('/api/config', 'PUT', config);
  await json('/api/users', 'POST', { username: 'audituser', password: 'LocalAudit-20260908', displayName: 'Audit User', role: 'user' });
  const login = await api('/api/auth/login', 'POST', { username: 'audituser', password: 'LocalAudit-20260908' }); const userCookie = login.headers.get('set-cookie').split(';')[0];
  let personal = await json('/api/config', 'GET', undefined, userCookie);
  personal.models[0].reasoningPresets.push({ id: 'own', name: 'Own', kind: 'custom' });
  await json('/api/config', 'PUT', personal, userCookie);
  config = await json('/api/config'); assert.equal(config.models[0].reasoningPresets[0].id, 'default');
  await json('/api/config', 'PUT', config);
  personal = await json('/api/config', 'GET', undefined, userCookie); assert.ok(personal.models[0].reasoningPresets.some(p => p.id === 'own'));
  console.log('PASS: ordinary and admin saves preserve protected presets');
  config.models.push({ ...config.models[0], id: 'alias', sourceModel: 'model-b', isAlias: true });
  config = await json('/api/config', 'PUT', config); assert.equal(config.models.find(m => m.id === 'alias').connectionId, 'b');
  console.log('PASS: stale alias connection repaired');
  config.connections[0].apiKey = 'fake-test-key'; config = await json('/api/config', 'PUT', config);
  config.connections[0].clearApiKey = true; config = await json('/api/config', 'PUT', config); assert.equal(config.connections[0].hasApiKey, false);
  const context = await json('/api/models/context', 'POST', { modelId: 'model-a' }); assert.equal(context.apiContextWindowTokens, 4096);
  assert.equal(requests.at(-1).authorization, undefined);
  console.log('PASS: key removal and loaded context');
  for (const content of ['error', 'malformed', 'truncated']) { const c = await conversation(content); await start(c); assert.equal((await terminal(c)).status, 'error'); }
  console.log('PASS: stream errors and premature EOF are not successful completions');
  const history = await conversation('History', [{ id: 'history-user', role: 'user', content: 'Color?', createdAt: stamp() }, { id: 'history-assistant', role: 'assistant', content: 'Saved', createdAt: stamp(), toolEvents: [{ id: 'history-choice', name: 'ask_multiple_choice', status: 'completed', startedAt: stamp(), arguments: { questions: [] }, result: { answers: [{ selections: ['Blue'] }] } }] }, { id: 'history-followup', role: 'user', content: 'Remember?', createdAt: stamp() }]);
  await start(history); assert.equal((await terminal(history)).status, 'completed');
  const request = requests.filter(r => r.url.endsWith('/chat/completions')).at(-1);
  assert.ok(request.body.messages.some(m => m.role === 'tool' && m.content.includes('Blue'))); assert.equal(request.body.reasoning_effort, undefined);
  console.log('PASS: tool history retained and disabled reasoning omitted');
  const slow = await conversation('slow'); await start(slow); await waitStatus(slow, 'running');
  assert.equal((await api('/api/inference/unload', 'POST', { modelId: 'model-a' })).status, 200);
  assert.ok(requests.some(r => r.url.endsWith('/unload')));
  assert.equal((await api(`/api/conversations/${slow.id}`, 'DELETE')).status, 204);
  await delay(1000); assert.equal((await api(`/api/conversations/${slow.id}`)).status, 404); assert.equal((await api(`/api/chat/${slow.id}`)).status, 404);
  console.log('PASS: active unload allowed; deleted generation cannot recreate conversation');
  const choice = await conversation('choice'); await start(choice, { tools: { multipleChoice: true } }); await waitStatus(choice, 'waiting');
  assert.equal((await api(`/api/chat/${choice.id}`, 'DELETE')).status, 202); assert.equal((await terminal(choice)).status, 'stopped');
  const stopped = await json(`/api/conversations/${choice.id}`); assert.equal(stopped.branches[0].messages.at(-1).toolEvents[0].status, 'error');
  const orphan = await conversation('Orphan', [{ id: 'orphan-assistant', role: 'assistant', content: '', createdAt: stamp(), toolEvents: [{ id: 'orphan-tool', name: 'ask_multiple_choice', status: 'waiting', arguments: { questions: [{ question: 'Color?', type: 'single_select', options: ['Blue', 'Red'] }] }, startedAt: stamp() }] }]);
  assert.equal((await json(`/api/conversations/${orphan.id}`)).branches[0].messages[0].toolEvents[0].status, 'error');
  console.log('PASS: stopping questions and recovering orphan questions');
  let first; let last;
  for (let i = 0; i < 66; i++) { const c = await conversation('Cache'); first ||= c; last = c; await start(c); await terminal(c); }
  await delay(100); assert.equal((await api(`/api/chat/${first.id}`)).status, 404); assert.equal((await api(`/api/chat/${last.id}`)).status, 200);
  console.log('PASS: completed job cache is bounded');
  config = await json('/api/config');
  config.models = config.models.map(m => m.id === 'model-b' ? { ...m, reasoningSupported: true, reasoningEfforts: ['off', 'low', 'medium', 'xhigh', 'on'] } : m);
  config = await json('/api/config', 'PUT', config);
  const effortAlias = config.models.find(m => m.id === 'alias');
  assert.deepEqual(effortAlias.reasoningPresets.filter(p => p.kind === 'builtin').map(p => p.effort), ['off', 'low', 'medium', 'xhigh']);
  for (const effort of ['off', 'low', 'medium', 'xhigh']) {
    const c = await conversation('effort'); await start(c, { modelId: 'alias', reasoningPresetId: effort });
    assert.equal((await terminal(c)).status, 'completed');
    assert.equal(requests.filter(r => r.url.endsWith('/chat/completions')).at(-1).body.reasoning_effort, effort === 'off' ? 'none' : effort);
  }
  config.models = config.models.map(m => m.id === 'model-b' ? { ...m, reasoningEfforts: ['off', 'on'] } : m.id === 'alias' ? { ...m, systemPrompt: 'Base prompt', reasoningPresets: [...m.reasoningPresets, ...['replace', 'prepend', 'append'].map(mode => ({ id: mode, name: mode, kind: 'custom', effort: 'high', systemPrompt: 'Custom prompt', systemPromptMode: mode }))] } : m);
  config = await json('/api/config', 'PUT', config);
  assert.deepEqual(config.models.find(m => m.id === 'alias').reasoningPresets.filter(p => p.kind === 'builtin').map(p => p.name), ['Fast', 'Thinking']);
  for (const mode of ['replace', 'prepend', 'append', 'on']) {
    const c = await conversation('template'); await start(c, { modelId: 'alias', reasoningPresetId: mode });
    assert.equal((await terminal(c)).status, 'completed');
    const body = requests.filter(r => r.url.endsWith('/chat/completions')).at(-1).body;
    assert.equal(body.reasoning_effort, mode === 'on' ? 'medium' : undefined);
    const prompt = body.messages.find(m => m.role === 'system').content;
    assert.equal(prompt, mode === 'replace' ? 'Custom prompt' : mode === 'prepend' ? 'Custom prompt\n\nBase prompt' : mode === 'append' ? 'Base prompt\n\nCustom prompt' : 'Base prompt');
  }
  console.log('PASS: alias effort/toggle inheritance, wire values, unsupported effort omission, and all custom prompt modes');
  console.log(`Integration checks passed. Test data: ${data}`);
  if (process.argv.includes('--keep-open')) { console.log(`QA_URL=${root}\nQA_USER=audit\nQA_PASSWORD=LocalAudit-20260908`); await new Promise(() => {}); }
} catch (error) { console.error(logs); throw error; }
finally { server.kill(); mock.closeAllConnections(); mock.close(); }
