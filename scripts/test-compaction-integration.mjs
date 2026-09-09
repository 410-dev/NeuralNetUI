// Isolated app database and mock inference server; never contacts a configured provider.
import assert from 'node:assert/strict';
import { estimateTokens } from '../lib/harness.ts';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const requests = []; let mode = 'reasoning'; let streams = 0; let disconnected = 0;
const mock = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  requests.push(req.url);
  if (req.url !== '/v1/chat/completions') { res.writeHead(404); return res.end('{}'); }
  const body = JSON.parse(raw);
  requests.push(body);
  if (!body.stream && mode === 'failure') { res.writeHead(500); return res.end('failed'); }
  if (!body.stream) { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({choices:[{message:{content:'Short summary of progress.'},finish_reason:'stop'}]})); }
  streams++;
  res.setHeader('Content-Type', 'text/event-stream');
  if ((mode === 'reasoning' || mode === 'content' || mode === 'limit' || mode === 'failure' || mode === 'zero' || mode === 'tool') && (streams === 1 || mode === 'limit')) {
    res.write(`data: ${JSON.stringify({choices:[{delta:(mode === 'tool' ? {tool_calls:[{index:0,id:'partial',type:'function',function:{name:'get_current_time',arguments:'x'.repeat(7000)}}]} : {[mode === 'content' ? 'content' : 'reasoning_content']:'x'.repeat(7000)})}]})}\n\n`);
    const timer = setTimeout(() => res.end('data: [DONE]\n\n'), 10000);
    res.on('close', () => { disconnected++; clearTimeout(timer); });
    return;
  }
  res.end(`data: ${JSON.stringify({choices:[{delta:{content:'Finished.'},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);
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
async function chat(modelId, content, { effort = 'off', tools, prior = [], sendReasoning = false, stop = false, expected = 'completed' } = {}) {
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
  assert.equal(last.status, stop ? 'stopped' : expected, JSON.stringify(last));
  assert.equal(last.waitPhase, undefined);
  assert.equal(last.waitProgress, undefined);
  return { id, snapshots, message: last.message, error: last.error };
}

try {
  for (let i = 0; i < 120; i++) { try { if ((await fetch(root + '/api/auth/status')).ok) break; } catch {} await delay(100); }
  const setup = await api('/api/auth/setup', 'POST', { username:'compactqa', displayName:'QA', password:'LocalCompactionQA-213' });
  assert.equal(setup.status,201); cookie = setup.headers.get('set-cookie').split(';')[0];
  config = await json('/api/config');
  const model = {id:'standard',sourceModel:'standard',name:'Mock',connectionId:'standard',isAlias:false,visible:true,reasoningSupported:false,reasoningPresets:[],contextWindowTokens:4096};
  config.connections = [{id:'standard',name:'Mock',driver:'openai',baseUrl:`${backend}/v1`,apiKey:'',clearApiKey:true,models:[model]}];
  config.models = [model]; config.preferences.onDemand = false;
  Object.assign(config.harnessSettings, {contextMode:'compacting',compactThreshold:50,maxCompactionResumes:1,resumePrompt:'SUMMARY=%COMPRESSED% USER=%USER_PROMPT%'});
  config = await json('/api/config','PUT',config);
  for (const scenario of ['reasoning','content','limit','presend','failure','zero','tool']) {
    mode = scenario; streams = 0; requests.length = 0;
    config.harnessSettings.maxCompactionResumes = scenario === 'zero' ? 0 : 1;
    config = await json('/api/config','PUT',config);
    const prior = scenario === 'presend' ? [{id:'old-u',role:'user',content:'old'.repeat(2500),createdAt:new Date().toISOString()},{id:'old-a',role:'assistant',content:'previous',createdAt:new Date().toISOString()}] : [];
    const result = await chat('standard','Original $& %COMPRESSED% request',{prior,expected:['limit','failure','zero'].includes(scenario) ? 'error' : 'completed'});
    const bodies = requests.filter(x => typeof x === 'object');
    for (const request of bodies.filter(x => !x.stream)) assert.ok(estimateTokens(request.messages) + request.max_tokens < 4096);
    if (scenario === 'tool') assert.equal(result.message.toolEvents.length,0);
    if (scenario === 'zero') { assert.equal(streams,1); assert.equal(bodies.length,1); assert.match(result.error,/compaction|압축/i); console.log('PASS zero'); continue; }
    assert.ok(bodies.some(x => x.stream === false), scenario);
    if (scenario === 'failure') { assert.equal(streams,1); assert.match(result.error,/Harness generation failed/); console.log('PASS failure'); continue; }
    if (scenario === 'presend') assert.equal(bodies[0].stream,false);
    else {
      assert.equal(streams,2);
      const resumed = bodies.filter(x => x.stream)[1];
      assert.match(JSON.stringify(resumed.messages),/SUMMARY=Short summary of progress/);
      assert.match(JSON.stringify(resumed.messages),/USER=Original \$& %COMPRESSED% request/);
      assert.ok(bodies.filter(x => !x.stream).some(x => JSON.stringify(x.messages).includes('xxxx')));
    }
    if (scenario === 'limit') assert.match(result.error,/compaction|압축/i);
    console.log('PASS',scenario);
    if (scenario !== 'presend') assert.ok(disconnected > 0, 'upstream was cancelled');
  }
} finally {
  child.kill(); mock.closeAllConnections(); await new Promise(resolve=>mock.close(resolve));
}
