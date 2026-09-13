// Isolated beta 4 fixture: validates storage/audit APIs and holds two live UI states.
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
const data = await mkdtemp(path.join(os.tmpdir(), 'neuralnetui-beta4-'));
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: process.cwd(), windowsHide: true, env: { ...process.env, NEURAL_CHAT_DATA_DIR: data, NEURAL_CHAT_DB_PATH: path.join(data, 'qa.sqlite3') }, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', chunk => { logs = (logs + chunk).slice(-8000); }); child.stderr.on('data', chunk => { logs = (logs + chunk).slice(-8000); });
const root = `http://127.0.0.1:${port}`; let cookie = '';
async function api(route, method = 'GET', body) { return fetch(root + route, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(180000) }); }
async function json(route, method, body) { const response = await api(route, method, body); const value = await response.json(); assert.ok(response.ok, JSON.stringify(value)); return value; }
async function jsonAs(route, authCookie, method = 'GET', body) { const response = await fetch(root + route, { method, headers: { 'Content-Type': 'application/json', cookie: authCookie }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(180000) }); const value = await response.json(); assert.ok(response.ok, `${route}: ${JSON.stringify(value)}`); return value; }
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
  await json('/api/users/defaults', 'PATCH', { defaultStorageQuotaBytes: 2 * 1024 * 1024 });
  const created = await json('/api/users', 'POST', { username: 'storageqa', displayName: 'Storage QA', password: 'LocalBeta3QA-221', role: 'user' });
  const managedUser = created.users.find(user => user.username === 'storageqa'); assert.ok(managedUser); assert.equal(managedUser.storageQuotaBytes, 2 * 1024 * 1024);
  const login = await fetch(`${root}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'storageqa', password: 'LocalBeta3QA-221' }) });
  assert.equal(login.status, 200); const userCookie = login.headers.get('set-cookie').split(';')[0];
  const image = Buffer.alloc(1536 * 1024); Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(image);
  const thumbnail = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const form = new FormData(); form.append('files', new File([image], 'large-screenshot.png', { type: 'image/png' })); form.append('thumbnail-0', new File([thumbnail], 'preview.png', { type: 'image/png' })); form.append('retained', 'true');
  const upload = await fetch(`${root}/api/uploads`, { method: 'POST', headers: { cookie: userCookie }, body: form }); const uploaded = await upload.json(); assert.equal(upload.status, 201, JSON.stringify(uploaded));
  const ownStorageResponse = await fetch(`${root}/api/storage`, { headers: { cookie: userCookie } }); const ownStorage = await ownStorageResponse.json(); assert.equal(ownStorageResponse.status, 200); assert.equal(ownStorage.usedBytes, image.length); assert.equal(ownStorage.files[0].id, uploaded.attachments[0].id);
  const usersAfterUpload = await json('/api/users'); assert.equal(usersAfterUpload.users.find(user => user.id === managedUser.id).storageUsedBytes, image.length);
  const ownedImage = await fetch(`${root}/api/uploads/${uploaded.attachments[0].id}`, { headers: { cookie: userCookie } }); assert.equal(ownedImage.status, 200);
  const ownedThumbnail = await fetch(`${root}/api/uploads/${uploaded.attachments[0].id}?variant=thumbnail`, { headers: { cookie: userCookie } }); assert.equal(ownedThumbnail.status, 200); assert.equal(ownedThumbnail.headers.get('content-type'), 'image/jpeg');
  const crossUserImage = await fetch(`${root}/api/uploads/${uploaded.attachments[0].id}`, { headers: { cookie } }); assert.equal(crossUserImage.status, 404);
  const audit = await json(`/api/users/${managedUser.id}/audit?view=files&page=1&pageSize=24&sort=name_asc`); assert.equal(audit.files[0].name, 'large-screenshot.png'); assert.equal(audit.total, 1); assert.equal(audit.sort, 'name_asc');
  const auditThumbnail = await fetch(`${root}/api/users/${managedUser.id}/audit?download=media-file&uploadId=${uploaded.attachments[0].id}&inline=1&variant=thumbnail`, { headers: { cookie } }); assert.equal(auditThumbnail.status, 200); assert.equal(auditThumbnail.headers.get('content-type'), 'image/jpeg');
  const forbiddenAudit = await fetch(`${root}/api/users/${managedUser.id}/audit`, { headers: { cookie: userCookie } }); assert.equal(forbiddenAudit.status, 403);
  const mediaExport = await fetch(`${root}/api/users/${managedUser.id}/audit?download=media`, { headers: { cookie } }); assert.equal(mediaExport.status, 200); assert.equal(mediaExport.headers.get('content-type'), 'application/zip'); assert.equal(Buffer.from(await mediaExport.arrayBuffer()).readUInt32LE(0), 0x04034b50);
  const tooSmall = await api(`/api/users/${managedUser.id}`, 'PATCH', { storageQuotaBytes: 1024 * 1024 }); assert.equal(tooSmall.status, 409);
  for (let index = 1; index <= 21; index++) {
    const conversationId = `storage-audit-${index}`; const branchId = `${conversationId}-main`; const forkId = `${conversationId}-fork`; const createdAt = new Date(Date.now() + index).toISOString();
    await jsonAs('/api/conversations', userCookie, 'POST', { id: conversationId, title: `Audit conversation ${String(index).padStart(2, '0')}`, modelId: 'qa-model', activeBranchId: branchId, createdAt, updatedAt: createdAt, branches: [{ id: branchId, name: 'Main', createdAt, updatedAt: createdAt, messages: [{ id: `${conversationId}-user`, role: 'user', content: `message ${index}`, createdAt }] }, { id: forkId, name: 'Fork', parentBranchId: branchId, createdAt, updatedAt: createdAt, messages: [{ id: `${conversationId}-fork-user`, role: 'user', content: `fork ${index}`, createdAt }] }] });
  }
  const conversationPage = await json(`/api/users/${managedUser.id}/audit?view=conversations&page=2&pageSize=20`); assert.equal(conversationPage.total, 21); assert.equal(conversationPage.page, 2); assert.equal(conversationPage.items.length, 1); assert.equal(conversationPage.items[0].branchCount, 2);
  const preview = await json(`/api/users/${managedUser.id}/audit?view=conversation&conversationId=${conversationPage.items[0].id}`); assert.equal(preview.conversation.branches.length, 2); assert.equal(preview.conversation.branches[1].messages[0].content.startsWith('fork '), true);
  console.log('PASS beta 4 ownership, quota totals, paginated audit views, branch preview, and ZIP export');
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
  console.log(`PASS beta 4 held states: post-tool prompt progress and live compaction output`);
  if (keep) { console.log(`QA_READY ${root} beta3qa LocalBeta3QA-220 tool-progress live-compaction`); await new Promise(() => {}); }
  releaseHold();
  await waitSnapshot('tool-progress', value => value.status === 'completed');
  await waitSnapshot('live-compaction', value => value.status === 'completed');
} catch (error) { console.error(logs); throw error; }
finally { releaseHold(); child.kill(); mock.closeAllConnections(); await new Promise(resolve => mock.close(resolve)); }
