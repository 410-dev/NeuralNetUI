// Isolated beta 3 UI fixture: holds one post-tool prompt-progress job and one live compaction job.
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

const keep = process.env.BETA3_QA_KEEP === '1';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let resolveHold; let holdReleased = false; const hold = new Promise(resolve => { resolveHold = resolve; });
const releaseHold = () => { if (!holdReleased) { holdReleased = true; resolveHold(); } };
const sse = (response, payload) => response.write(`data: ${JSON.stringify(payload)}\n\n`);
const mock = http.createServer(async (request, response) => {
  let raw = ''; for await (const chunk of request) raw += chunk;
  if (request.url === '/api/v1/models') { response.setHeader('Content-Type', 'application/json'); return response.end(JSON.stringify({ models: [] })); }
  if (request.url !== '/v1/chat/completions') { response.writeHead(404); return response.end('{}'); }
  const body = JSON.parse(raw); const messages = body.messages || [];
  const compaction = messages[0]?.role === 'system' && String(messages[0]?.content).includes('Summarize the conversation');
  response.setHeader('Content-Type', 'text/event-stream');
  if (compaction) {
    sse(response, { choices: [{ delta: { reasoning_content: 'Selecting durable context. ' } }] });
    await delay(120);
    sse(response, { choices: [{ delta: { content: 'Live compacted summary.' } }] });
    await hold;
    sse(response, { choices: [{ delta: {}, finish_reason: 'stop' }] }); response.end('data: [DONE]\n\n'); return;
  }
  if (messages.some(message => message.role === 'tool')) {
    sse(response, { type: 'prompt_processing.progress', progress: .47 });
    while (!holdReleased) {
      const released = await Promise.race([hold.then(() => true), delay(2000).then(() => false)]);
      if (released) break;
      sse(response, { type: 'prompt_processing.progress', progress: .47 });
    }
    sse(response, { choices: [{ delta: { content: 'Tool result received.' }, finish_reason: 'stop' }] }); response.end('data: [DONE]\n\n'); return;
  }
  if (messages.some(message => String(message.content).includes('QA_TOOL_PROGRESS'))) {
    sse(response, { choices: [{ delta: { tool_calls: [{ index: 0, id: 'clock-call', type: 'function', function: { name: 'get_current_time', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] });
    response.end('data: [DONE]\n\n'); return;
  }
  sse(response, { choices: [{ delta: { content: 'Compaction complete.' }, finish_reason: 'stop' }] }); response.end('data: [DONE]\n\n');
});
mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
const reserve = http.createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
const data = await mkdtemp(path.join(os.tmpdir(), 'neuralnetui-beta3-'));
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: process.cwd(), windowsHide: true, env: { ...process.env, NEURAL_CHAT_DATA_DIR: data, NEURAL_CHAT_DB_PATH: path.join(data, 'qa.sqlite3') }, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', chunk => { logs = (logs + chunk).slice(-8000); }); child.stderr.on('data', chunk => { logs = (logs + chunk).slice(-8000); });
const root = `http://127.0.0.1:${port}`; let cookie = '';
async function api(route, method = 'GET', body) { return fetch(root + route, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(180000) }); }
async function json(route, method, body) { const response = await api(route, method, body); const value = await response.json(); assert.ok(response.ok, JSON.stringify(value)); return value; }
async function snapshot(id) {
  const response = await api(`/api/chat/${id}`); assert.ok(response.ok && response.body);
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
  try { for (;;) { const {done, value} = await reader.read(); if (done) break; buffer += decoder.decode(value, {stream:true}); const match = /data: (\{[^\n]+\})/.exec(buffer); if (match) return JSON.parse(match[1]); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
async function waitSnapshot(id, predicate) { for (let i = 0; i < 100; i++) { const value = await snapshot(id); if (predicate(value)) return value; await delay(50); } throw new Error(`Timed out waiting for ${id}`); }
async function seed(id, messages) {
  const stamp = new Date().toISOString();
  const branchId = `${id}-main`;
  await json('/api/conversations', 'POST', { id, title: id, modelId: 'qa-model', activeBranchId: branchId, createdAt: stamp, updatedAt: stamp, branches: [{ id: branchId, name: 'Main', createdAt: stamp, updatedAt: stamp, messages }] });
  await json('/api/chat', 'POST', { conversationId: id, branchId, assistantMessageId: `${id}-assistant`, modelId: 'qa-model', messages, tools: { currentTime: true } });
}

try {
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`${root}/api/auth/status`)).ok) break; } catch {} await delay(100); }
  const setup = await api('/api/auth/setup', 'POST', { username: 'beta3qa', displayName: 'Beta 3 QA', password: 'LocalBeta3QA-220' }); assert.equal(setup.status, 201); cookie = setup.headers.get('set-cookie').split(';')[0];
  let config = await json('/api/config');
  const model = { id: 'qa-model', sourceModel: 'qa-model', name: 'Beta 3 model', connectionId: 'qa', isAlias: false, visible: true, reasoningSupported: false, reasoningPresets: [], contextWindowTokens: 4096 };
  config.connections = [{ id: 'qa', name: 'QA', driver: 'openai', baseUrl: `http://127.0.0.1:${mock.address().port}/v1`, apiKey: '', clearApiKey: true, models: [model] }];
  config.models = [model]; config.experimental.openAIProgress = true; Object.assign(config.harnessSettings, { contextMode: 'compacting', compactThreshold: 50, maxCompactionResumes: 1 });
  await json('/api/config', 'PUT', config);
  const stamp = new Date().toISOString();
  await seed('tool-progress', [{ id: 'tool-user', role: 'user', content: 'QA_TOOL_PROGRESS', createdAt: stamp }]);
  const toolState = await waitSnapshot('tool-progress', value => value.waitPhase === 'processing-prompt' && value.waitProgress === 47 && value.message.toolEvents?.some(event => event.status === 'completed'));
  assert.equal(toolState.message.toolEvents[0].result.timeZone.length > 0, true);
  const coveredTool = { id: 'covered-assistant', role: 'assistant', content: 'old answer', createdAt: stamp, toolEvents: [{ id: 'covered-tool', name: 'visit_page', status: 'completed', startedAt: stamp, result: { text: 'covered tool output '.repeat(300) } }], steps: [{ kind: 'tools', ids: ['covered-tool'] }, { kind: 'content', text: 'old answer' }] };
  await seed('live-compaction', [{ id: 'old-user', role: 'user', content: 'old context '.repeat(1200), createdAt: stamp }, coveredTool, { id: 'compact-user', role: 'user', content: 'QA_COMPACTION', createdAt: stamp }]);
  await waitSnapshot('live-compaction', value => value.waitPhase === 'compacting-context' && value.message.steps?.some(step => step.kind === 'compaction' && !step.seconds && step.reasoning && step.summary));
  console.log(`PASS beta 3 held states: post-tool prompt progress and live compaction output`);
  if (keep) { console.log(`QA_READY ${root} beta3qa LocalBeta3QA-220 tool-progress live-compaction`); await new Promise(() => {}); }
  releaseHold();
  await waitSnapshot('tool-progress', value => value.status === 'completed');
  await waitSnapshot('live-compaction', value => value.status === 'completed');
} catch (error) { console.error(logs); throw error; }
finally { releaseHold(); child.kill(); mock.closeAllConnections(); await new Promise(resolve => mock.close(resolve)); }
