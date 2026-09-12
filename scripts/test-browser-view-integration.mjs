import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const sendEvent = (response, payload) => response.end(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`);

const mock = http.createServer(async (request, response) => {
  let raw = ""; for await (const chunk of request) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  if (request.url !== "/v1/chat/completions") { response.writeHead(404).end(); return; }
  const browserResults = (body.messages || []).filter((message) => message.role === "tool" && message.name === "browser");
  response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  if (!browserResults.length) {
    sendEvent(response, { choices: [{ delta: { tool_calls: [{ index: 0, id: "open-browser", type: "function", function: { name: "browser", arguments: JSON.stringify({ action: "open", url: "https://example.com" }) } }] }, finish_reason: "tool_calls" }] });
    return;
  }
  if (browserResults.length === 1) {
    const opened = JSON.parse(browserResults[0].content);
    sendEvent(response, { choices: [{ delta: { tool_calls: [{ index: 0, id: "handoff-browser", type: "function", function: { name: "browser", arguments: JSON.stringify({ action: "request_user", session_id: opened.sessionId, message: "Verify the shared page." }) } }] }, finish_reason: "tool_calls" }] });
    return;
  }
  sendEvent(response, { choices: [{ delta: { content: "Browser handoff completed." }, finish_reason: "stop" }] });
});

mock.listen(0, "127.0.0.1"); await once(mock, "listening");
const data = await mkdtemp(path.join(os.tmpdir(), "neural-browser-view-"));
const port = Number(process.env.BROWSER_VIEW_TEST_PORT || 32198); const root = `http://127.0.0.1:${port}`;
const appDir = process.env.BROWSER_VIEW_APP_DIR ? path.resolve(process.env.BROWSER_VIEW_APP_DIR) : process.cwd();
const staged = Boolean(process.env.BROWSER_VIEW_APP_DIR);
const child = spawn(process.env.BROWSER_VIEW_NODE || process.execPath, staged ? ["server.js"] : ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: appDir, env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: String(port), NEURAL_CHAT_DATA_DIR: data, NEURAL_CHAT_DB_PATH: path.join(data, "test.sqlite3") }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let logs = ""; child.stdout.on("data", (chunk) => logs += chunk); child.stderr.on("data", (chunk) => logs += chunk);
let cookie = "";

async function api(route, method = "GET", body) {
  return fetch(root + route, { method, headers: { "Content-Type": "application/json", cookie }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) });
}
async function json(route, method, body) { const response = await api(route, method, body); const value = await response.json(); assert.ok(response.ok, JSON.stringify(value)); return value; }
async function waitForSnapshot(conversationId, predicate) {
  const response = await api(`/api/chat/${conversationId}`); assert.ok(response.ok);
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffered = "";
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break; buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split("\n"); buffered = lines.pop() || "";
      for (const line of lines) if (line.startsWith("data: {") && predicate(JSON.parse(line.slice(6)))) return;
    }
  } finally { await reader.cancel().catch(() => undefined); }
  throw new Error("Expected chat snapshot was not received.");
}

try {
  for (let index = 0; index < 100; index += 1) { try { if ((await fetch(`${root}/api/auth/status`)).ok) break; } catch { /* wait */ } await delay(100); }
  const setup = await api("/api/auth/setup", "POST", { username: "browserqa", displayName: "Browser QA", password: "BrowserLocal-20260913" });
  assert.equal(setup.status, 201); cookie = setup.headers.get("set-cookie").split(";")[0];
  let config = await json("/api/config");
  const model = { id: "browser-model", sourceModel: "browser-model", name: "Browser model", isAlias: false, visible: true, connectionId: "test", reasoningSupported: false, reasoningPresets: [] };
  config.connections = [{ id: "test", name: "Mock", driver: "openai", baseUrl: `http://127.0.0.1:${mock.address().port}/v1`, apiKey: "", models: [model] }];
  config.models = [model]; config.experimental.browserTool = true;
  await json("/api/config", "PUT", config);
  const stamp = new Date().toISOString(); const conversationId = "browser-view";
  const message = { id: "browser-request", role: "user", content: "Open the browser", createdAt: stamp };
  await json("/api/conversations", "POST", { id: conversationId, title: "Browser view", modelId: model.id, activeBranchId: "main", createdAt: stamp, updatedAt: stamp, branches: [{ id: "main", name: "Main", messages: [message], createdAt: stamp, updatedAt: stamp }] });
  await json("/api/chat", "POST", { conversationId, branchId: "main", assistantMessageId: "browser-response", modelId: model.id, messages: [message], tools: { browser: true } });
  await waitForSnapshot(conversationId, (snapshot) => snapshot.status === "waiting" && snapshot.message.toolEvents?.some((event) => event.id === "handoff-browser" && event.status === "waiting"));
  const state = await json(`/api/browser-view?conversationId=${conversationId}`); assert.equal(state.available, true); assert.equal(state.headed, process.platform === "win32" || process.platform === "darwin" || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY));
  assert.match(state.url, /^https:\/\/example\.com\/?$/);
  const frame = await api(`/api/browser-view?conversationId=${conversationId}&frame=1&sessionId=${encodeURIComponent(state.sessionId)}`); assert.equal(frame.status, 200); assert.equal(frame.headers.get("content-type"), "image/jpeg"); assert.ok((await frame.arrayBuffer()).byteLength > 1_000);
  const navigated = await json(`/api/browser-view?conversationId=${conversationId}`, "POST", { action: "navigate", sessionId: state.sessionId, url: "https://example.org" }); assert.match(navigated.url, /^https:\/\/example\.org\/?$/);
  if (process.env.BROWSER_VIEW_QA_KEEP === "1") {
    console.log(`QA_READY ${root} browserqa BrowserLocal-20260913`);
    await new Promise((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
    console.log("QA_STOPPED");
  } else {
    await json(`/api/chat/${conversationId}/input`, "POST", { toolCallId: "handoff-browser", value: { completed: true } });
    await waitForSnapshot(conversationId, (snapshot) => snapshot.status === "completed" && snapshot.message.content.includes("Browser handoff completed."));
    console.log("PASS: headed browser session, authenticated frame, navigation, human handoff, and completion");
  }
} catch (error) { console.error(logs); throw error; }
finally {
  child.kill(); mock.close();
  if (child.exitCode === null) await Promise.race([once(child, "exit"), delay(5_000)]);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try { await rm(data, { recursive: true, force: true }); break; }
    catch (error) { if (attempt === 4) throw error; await delay(100 * (attempt + 1)); }
  }
}
