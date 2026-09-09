// Isolated app database; --live opts into localhost:1234 inference, --keep leaves the QA app open.
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

const live = process.argv.includes('--live');
const keep = process.argv.includes('--keep');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const requests = [];
const mock = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  requests.push(req.url);
  if (req.url !== '/v1/chat/completions') { res.writeHead(404); return res.end('{}'); }
  const body = JSON.parse(raw);
  assert.equal(body.stream_options.include_usage, true);
  res.setHeader('Content-Type', 'text/event-stream');
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Standard API works.' } }] })}\n\n`);
  res.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 30, completion_tokens: 4, total_tokens: 34 } })}\n\ndata: [DONE]\n\n`);
});
mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
const backend = `http://127.0.0.1:${mock.address().port}`;
const reserve = http.createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
const data = await mkdtemp(path.join(os.tmpdir(), 'neuralnetui-progress-'));
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
  windowsHide: true, env: { ...process.env, NEURAL_CHAT_DATA_DIR: data, NEURAL_CHAT_DB_PATH: path.join(data, 'qa.sqlite3') }, stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = ''; child.stdout.on('data', c => { logs = (logs + c).slice(-8000); }); child.stderr.on('data', c => { logs = (logs + c).slice(-8000); });
const root = `http://127.0.0.1:${port}`; let cookie = ''; let config; let sequence = 0;
async function api(route, method = 'GET', body) {
  return fetch(root + route, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(180000) });
}
async function json(route, method, body) { const r = await api(route, method, body); const value = await r.json(); assert.ok(r.ok, JSON.stringify(value)); return value; }
async function chat(modelId, content, { effort = 'off', tools, prior = [], sendReasoning = false, stop = false } = {}) {
  const id = `progress-${++sequence}`; const stamp = new Date().toISOString();
  const messages = [...prior, { id: `${id}-user`, role: 'user', content, createdAt: stamp }];
  await json('/api/conversations', 'POST', { id, title: content.slice(0, 50), modelId, activeBranchId: id, createdAt: stamp, updatedAt: stamp, branches: [{ id, name: 'Main', createdAt: stamp, updatedAt: stamp, messages }] });
  const preset = config.models.find(m => m.id === modelId).reasoningPresets.find(p => p.effort === effort);
  const initial = await json('/api/chat', 'POST', { conversationId: id, branchId: id, assistantMessageId: `${id}-assistant`, modelId, reasoningPresetId: preset?.id, messages: messages.map(m => ({ ...m, ...(m.reasoning ? { reasoning_content: m.reasoning } : {}) })), tools, sendReasoning });
  const snapshots = [initial]; const response = await api(`/api/chat/${id}`);
  const reader = response.body.getReader(); let buffer = ''; const decoder = new TextDecoder(); let stopped = false;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true }); const records = buffer.split('\n\n'); buffer = records.pop() || '';
      for (const record of records) if (record.startsWith('data: {')) {
        const next = JSON.parse(record.slice(6)); snapshots.push(next);
        if (stop && !stopped && (next.waitPhase === 'processing-prompt' || next.message.content || next.message.reasoning)) { stopped = true; assert.equal((await api(`/api/chat/${id}`, 'DELETE')).status, 202); }
      }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const last = snapshots.at(-1);
  assert.equal(last.status, stop ? 'stopped' : 'completed', JSON.stringify(last));
  assert.equal(last.waitPhase, undefined);
  assert.equal(last.waitProgress, undefined);
  return { id, snapshots, message: last.message };
}

try {
  for (let i = 0; i < 120; i++) { try { if ((await fetch(root + '/api/auth/status')).ok) break; } catch {} await delay(100); }
  const setup = await api('/api/auth/setup', 'POST', { username: 'progressqa', displayName: 'Progress QA', password: 'LocalProgressQA-211' });
  assert.equal(setup.status, 201); cookie = setup.headers.get('set-cookie').split(';')[0];
  config = await json('/api/config');
  const model = { id: 'standard', sourceModel: 'standard', name: 'Standard server', connectionId: 'standard', isAlias: false, visible: true, reasoningSupported: false, reasoningPresets: [], contextWindowTokens: 4096 };
  config.connections = [{ id: 'standard', name: 'Standard server', driver: 'openai', baseUrl: `${backend}/v1`, apiKey: '', clearApiKey: true, models: [model] }];
  config.models = [model]; config.preferences.language = 'ko'; config.preferences.onDemand = false; config.harnessSettings.maxOutputTokens = 256;
  config = await json('/api/config', 'PUT', config);
  await chat('standard', 'standard only');
  assert.deepEqual(requests, ['/v1/chat/completions']);
  config.experimental.openAIProgress = true; config = await json('/api/config', 'PUT', config);
  const unsupported = await chat('standard', 'unsupported extension');
  assert.ok(unsupported.snapshots.some(s => s.progressUnavailable));
  assert.ok(!unsupported.snapshots.some(s => s.waitProgress !== undefined));
  assert.deepEqual(requests.slice(1), ['/api/v1/models', '/v1/chat/completions']);
  for (const mode of ['text', 'percent', 'donut', 'both']) {
    config.preferences.appearance.lmStudioProgress = mode; await json('/api/config', 'PUT', config);
    assert.equal((await json('/api/config')).preferences.appearance.lmStudioProgress, mode);
  }
  console.log('PASS standard host isolation, experimental unsupported fallback, progress settings persistence');
  if (live) {
    const discovered = await json('/api/models/detect', 'POST', { id: 'lm', driver: 'lmstudio', baseUrl: 'http://localhost:1234' });
    const inventory = await (await fetch('http://localhost:1234/api/v1/models')).json();
    const selected = inventory.models.filter(m => m.type === 'llm').sort((a, b) => Number(b.loaded_instances.length > 0) - Number(a.loaded_instances.length > 0) || a.size_bytes - b.size_bytes)[0];
    const lm = discovered.models.find(m => m.sourceModel === selected.key || m.sourceModel === selected.selected_variant);
    assert.ok(lm); lm.contextWindowTokens = 4096;
    config.connections = [{ id: 'lm', name: 'LM Studio QA', driver: 'lmstudio', baseUrl: 'http://localhost:1234', apiKey: '', models: [lm] }];
    config.models = [lm]; config.experimental.openAIProgress = false;
    config = await json('/api/config', 'PUT', config);
    const first = await chat(lm.id, 'Remember the word orchid. Reply with OK.');
    assert.ok(first.snapshots.some(s => s.waitPhase === 'processing-prompt' && typeof s.waitProgress === 'number'));
    const followup = await chat(lm.id, 'What word did I ask you to remember?', { prior: [
      { id: 'prior-u', role: 'user', content: 'Remember the word orchid. Reply with OK.', createdAt: new Date().toISOString() }, first.message,
    ] });
    assert.match(followup.message.content.toLowerCase(), /orchid/);
    const thinking = await chat(lm.id, 'What is 2+3? Explain briefly.', { effort: 'on' });
    assert.ok(thinking.message.reasoning && thinking.message.reasoningTokens > 0);
    const tools = await chat(lm.id, 'Call the get_current_time tool to tell me the current time. Do not guess.', { tools: { currentTime: true } });
    assert.ok(tools.message.toolEvents?.some(e => e.name === 'get_current_time' && e.status === 'completed'));
    await chat(lm.id, 'Count from 1 to 10000 and explain each number in detail.', { effort: 'on', stop: true });
    const fallback = await chat(lm.id, 'What is 2+3?', { prior: [{ ...thinking.message, id: 'prior-think' }], sendReasoning: true });
    assert.ok(fallback.snapshots.some(s => s.progressUnavailable));
    config.connections[0].driver = 'openai'; config.connections[0].baseUrl = 'http://localhost:1234/v1'; config.experimental.openAIProgress = true;
    config = await json('/api/config', 'PUT', config);
    const expanded = await chat(lm.id, 'Reply with OK.');
    assert.ok(expanded.snapshots.some(s => s.waitPhase === 'processing-prompt' && typeof s.waitProgress === 'number'));
    config.connections[0].driver = 'lmstudio'; config.connections[0].baseUrl = 'http://localhost:1234';
    config = await json('/api/config', 'PUT', config);
    console.log('PASS live LM Studio progress, off/on reasoning, history, tools, cancellation, reasoning-history fallback and OpenAI experiment');
  }
  console.log(`QA app: ${root} | user: progressqa | password: LocalProgressQA-211 | data: ${data}`);
  if (keep) await new Promise(() => {});
} catch (error) { console.error(logs); throw error; }
finally { child.kill(); await new Promise(resolve => mock.close(resolve)); }
