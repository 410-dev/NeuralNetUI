// End-to-end image QA against a live LM Studio server using an isolated app database.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const imagePath = path.resolve(option('image') || 'sample image.png');
const modelKey = option('model') || 'gemma4-31b-qat-uncensored-hauhaucs-balanced-mtp@q4_k_m';
const lmStudioUrl = option('url') || 'http://localhost:1234';
const appDir = process.env.IMAGE_APP_DIR ? path.resolve(process.env.IMAGE_APP_DIR) : process.cwd();
const staged = Boolean(process.env.IMAGE_APP_DIR);
const runtime = process.env.IMAGE_NODE || process.execPath;
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

await access(path.join(appDir, '.next', 'BUILD_ID'));
const sourceBytes = await readFile(imagePath);
const sourceMetadata = await sharp(sourceBytes).metadata();
assert.ok(sourceMetadata.width && sourceMetadata.height, 'The source image has no dimensions.');

const reserve = http.createServer();
reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'neuralnetui-image-live-'));
const child = spawn(runtime, staged ? ['server.js'] : ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
  cwd: appDir,
  windowsHide: true,
  env: { ...process.env, HOSTNAME: '127.0.0.1', PORT: String(port), NEURAL_CHAT_DATA_DIR: dataDir, NEURAL_CHAT_DB_PATH: path.join(dataDir, 'qa.sqlite3') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
child.stdout.on('data', chunk => { logs = (logs + chunk).slice(-12000); });
child.stderr.on('data', chunk => { logs = (logs + chunk).slice(-12000); });

const root = `http://127.0.0.1:${port}`;
let cookie = '';
async function request(route, { method = 'GET', body, headers = {}, timeout = 300_000 } = {}) {
  return fetch(root + route, { method, headers: { ...headers, ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body }), signal: AbortSignal.timeout(timeout) });
}
async function json(route, method, body) {
  const response = await request(route, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  const value = await response.json();
  assert.ok(response.ok, JSON.stringify(value));
  return value;
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    try { if ((await fetch(`${root}/api/auth/status`)).ok) { ready = true; break; } } catch { /* Wait for Next.js. */ }
    await delay(100);
  }
  assert.ok(ready, `The QA app did not start.\n${logs}`);

  const setup = await request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ username: 'imageqa', displayName: 'Image QA', password: 'LocalImageQA-211' }), headers: { 'content-type': 'application/json' } });
  assert.equal(setup.status, 201, await setup.text());
  cookie = setup.headers.get('set-cookie')?.split(';')[0] || '';
  assert.ok(cookie);

  let config = await json('/api/config');
  const discovered = await json('/api/models/detect', 'POST', { id: 'lm-image', driver: 'lmstudio', baseUrl: lmStudioUrl });
  const model = discovered.models.find(candidate => candidate.sourceModel === modelKey);
  assert.ok(model, `Model not discovered: ${modelKey}`);
  model.contextWindowTokens = 8192;
  model.visionImageMode = 'max-resolution';
  model.visionMaxEdgePixels = 1024;
  config.connections = [{ id: 'lm-image', name: 'LM Studio image QA', driver: 'lmstudio', baseUrl: lmStudioUrl, apiKey: '', models: [model] }];
  config.models = [model];
  config.preferences.onDemand = true;
  config.harnessSettings.maxOutputTokens = 128;
  config.harnessSettings.titleEnabled = false;
  config = await json('/api/config', 'PUT', config);

  const form = new FormData();
  form.append('files', new File([sourceBytes], path.basename(imagePath), { type: 'image/png' }));
  const thumbnailBytes = await sharp(sourceBytes).rotate().resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer();
  form.append('thumbnail-0', new File([thumbnailBytes], 'thumbnail.jpg', { type: 'image/jpeg' }));
  form.append('dimensions-0', JSON.stringify({ width: sourceMetadata.width, height: sourceMetadata.height }));
  form.append('retained', 'true');
  const uploadResponse = await request('/api/uploads', { method: 'POST', body: form });
  const uploadPayload = await uploadResponse.json();
  assert.equal(uploadResponse.status, 201, JSON.stringify(uploadPayload));
  const attachment = uploadPayload.attachments[0];
  assert.ok(attachment?.id);

  const storedResponse = await request(`/api/uploads/${attachment.id}?download=1`);
  assert.ok(storedResponse.ok);
  const storedBytes = Buffer.from(await storedResponse.arrayBuffer());
  assert.equal(hash(storedBytes), hash(sourceBytes), 'Stored original bytes changed.');

  const conversationId = `image-live-${Date.now()}`;
  const stamp = new Date().toISOString();
  const userMessage = { id: `${conversationId}-user`, role: 'user', content: 'Describe this image in one short sentence.', attachments: [attachment], createdAt: stamp };
  await json('/api/conversations', 'POST', { id: conversationId, title: 'Image live QA', modelId: model.id, activeBranchId: conversationId, createdAt: stamp, updatedAt: stamp, branches: [{ id: conversationId, name: 'Main', createdAt: stamp, updatedAt: stamp, messages: [userMessage] }] });
  const initial = await json('/api/chat', 'POST', { conversationId, branchId: conversationId, assistantMessageId: `${conversationId}-assistant`, modelId: model.id, messages: [{ ...userMessage, attachments: [{ id: attachment.id }] }] });
  const snapshots = [initial];
  const stream = await request(`/api/chat/${conversationId}`);
  assert.ok(stream.ok && stream.body);
  const reader = stream.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buffer += decoder.decode(value, { stream: true }); const records = buffer.split('\n\n'); buffer = records.pop() || '';
    for (const record of records) if (record.startsWith('data: {')) snapshots.push(JSON.parse(record.slice(6)));
  }
  const completed = snapshots.at(-1);
  assert.equal(completed.status, 'completed', JSON.stringify(completed));
  assert.ok(completed.message.content || completed.message.reasoning, 'The model returned no text.');

  const originalPath = path.join(dataDir, 'uploads', `${attachment.id}.original`);
  const derivativePath = path.join(dataDir, 'uploads', `${attachment.id}.model-v3-${model.visionMaxEdgePixels || 1024}.jpg`);
  const [diskOriginal, derivativeMetadata, derivativeStat] = await Promise.all([readFile(originalPath), sharp(derivativePath).metadata(), stat(derivativePath)]);
  assert.equal(hash(diskOriginal), hash(sourceBytes), 'Original on disk changed.');
  assert.ok((derivativeMetadata.width || Infinity) <= 1024 && (derivativeMetadata.height || Infinity) <= 1024);

  console.log(JSON.stringify({
    status: 'PASS', model: modelKey,
    original: { width: sourceMetadata.width, height: sourceMetadata.height, bytes: sourceBytes.length, sha256: hash(sourceBytes) },
    modelContext: { width: derivativeMetadata.width, height: derivativeMetadata.height, bytes: derivativeStat.size, format: derivativeMetadata.format },
    promptProgressObserved: snapshots.some(snapshot => snapshot.waitPhase === 'processing-prompt'),
    response: String(completed.message.content || completed.message.reasoning).slice(0, 500),
  }, null, 2));
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  child.kill();
}
