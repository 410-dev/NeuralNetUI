import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

// Beta 19: model server enable switches and online dots in connection settings, a confirmed delete,
// and a picker that greys out offline models, moves an offline selection and reports "server offline".
const shots = process.env.BETA19_SCREENSHOTS;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
/** A model server whose availability the test switches: while down it answers every request with 503. */
function modelServer(model) {
  const state = { down: false };
  const server = http.createServer((request, response) => {
    if (state.down) { response.writeHead(503).end(); return; }
    if (request.method === "GET" && request.url === "/v1/models") { response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify({ data: [{ id: model }] })); return; }
    if (request.method === "POST" && request.url === "/v1/chat/completions") {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `answer from ${model}` }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } })}\n\n`);
      response.end("data: [DONE]\n\n"); return;
    }
    response.writeHead(404).end();
  });
  return { server, state };
}
const alpha = modelServer("alpha-model"), beta = modelServer("beta-model");
for (const { server } of [alpha, beta]) { server.listen(0, "127.0.0.1"); await once(server, "listening"); }
const data = await mkdtemp(path.join(os.tmpdir(), "neural-beta19-"));
const reserve = http.createServer(); reserve.listen(0, "127.0.0.1"); await once(reserve, "listening");
const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
const root = `http://127.0.0.1:${port}`;
const appDir = process.env.BETA19_APP_DIR ? path.resolve(process.env.BETA19_APP_DIR) : process.cwd();
const staged = Boolean(process.env.BETA19_APP_DIR);
const runtime = process.env.BETA19_NODE || process.execPath;
const server = spawn(runtime, staged ? ["server.js"] : ["scripts/start-server.mjs", "start"], { cwd: appDir, windowsHide: true, env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: String(port), NEURAL_CHAT_DATA_DIR: data, NEURAL_CHAT_DB_PATH: path.join(data, "qa.sqlite3") }, stdio: ["ignore", "pipe", "pipe"] });
let logs = "", cookie = "", browser;
server.stdout.on("data", chunk => logs = (logs + chunk).slice(-12000));
server.stderr.on("data", chunk => logs = (logs + chunk).slice(-12000));
async function request(route, method = "GET", body, jar = cookie) { return fetch(root + route, { method, headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(jar ? { cookie: jar } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60_000) }); }
async function json(route, method = "GET", body, jar = cookie) { const response = await request(route, method, body, jar), value = await response.json().catch(() => ({})); assert.ok(response.ok, `${method} ${route}: ${JSON.stringify(value)}`); return value; }
// Server checks are cached for five seconds, so every state change waits the cache out.
const cacheWindow = () => delay(5_300);

try {
  for (let i = 0; i < 150; i++) { try { if ((await fetch(`${root}/api/auth/status`)).ok) break; } catch {} if (i === 149) throw new Error(`Server did not start.\n${logs}`); await delay(100); }
  const password = "Beta19-Local-QA-2026";
  const setup = await request("/api/auth/setup", "POST", { username: "beta19qa", displayName: "Beta 19 QA", password }); assert.equal(setup.status, 201);
  cookie = setup.headers.get("set-cookie").split(";")[0];
  const model = (id, name, connectionId) => ({ id, sourceModel: id, name, connectionId, isAlias: false, visible: true, reasoningSupported: false, reasoningPresets: [] });
  const alphaModel = model("alpha-model", "Alpha model", "alpha"), betaModel = model("beta-model", "Beta model", "beta");
  const config = await json("/api/config");
  config.preferences.language = "ko"; config.preferences.defaultModelId = alphaModel.id;
  config.connections = [
    { id: "alpha", name: "Alpha", driver: "openai", baseUrl: `http://127.0.0.1:${alpha.server.address().port}/v1`, apiKey: "", models: [alphaModel] },
    { id: "beta", name: "Beta", driver: "openai", baseUrl: `http://127.0.0.1:${beta.server.address().port}/v1`, apiKey: "", models: [betaModel] },
  ];
  config.models = [alphaModel, betaModel]; config.harnessSettings.titleEnabled = false;
  await json("/api/config", "PUT", config);
  assert.deepEqual((await json("/api/models/status")).statuses, { alpha: "online", beta: "online" });

  // A disabled server is saved, reported without a probe and refuses chat requests.
  const saved = await json("/api/config");
  saved.connections[1].disabled = true;
  await json("/api/config", "PUT", saved);
  assert.equal((await json("/api/config")).connections[1].disabled, true);
  assert.deepEqual((await json("/api/models/status")).statuses, { alpha: "online", beta: "disabled" });
  const stamp = new Date().toISOString();
  await json("/api/conversations", "POST", { id: "beta19-chat", title: "Beta 19 chat", modelId: betaModel.id, activeBranchId: "beta19-main", createdAt: stamp, updatedAt: stamp, branches: [{ id: "beta19-main", name: "Main", createdAt: stamp, updatedAt: stamp, messages: [{ id: "beta19-user", role: "user", content: "hello", createdAt: stamp }] }] });
  const job = await request("/api/chat", "POST", { conversationId: "beta19-chat", branchId: "beta19-main", assistantMessageId: "beta19-assistant", modelId: betaModel.id, messages: [{ role: "user", content: "hello" }] });
  assert.equal(job.status, 202);
  const events = await request("/api/chat/beta19-chat").then(response => response.text());
  assert.match(events, /server is disabled/);
  assert.doesNotMatch(events, /answer from beta-model/);
  saved.connections[1].disabled = false;
  await json("/api/config", "PUT", saved);

  // Administrators check the unsaved draft: an invalid address is offline, a disabled draft is not probed.
  const draftStates = await json("/api/models/status", "POST", { connections: [{ id: "alpha", driver: "openai", baseUrl: config.connections[0].baseUrl }, { id: "beta", driver: "openai", baseUrl: config.connections[1].baseUrl, disabled: true }, { id: "new", driver: "lmstudio", baseUrl: "not a url" }] });
  assert.deepEqual(draftStates.statuses, { alpha: "online", beta: "disabled", new: "offline" });
  assert.equal((await request("/api/users", "POST", { username: "beta19user", displayName: "Beta 19 User", password })).status, 201);
  const login = await request("/api/auth/login", "POST", { username: "beta19user", password }, "");
  const memberCookie = login.headers.get("set-cookie").split(";")[0];
  assert.equal((await request("/api/models/status", "POST", { connections: [] }, memberCookie)).status, 403, "only administrators probe drafts");
  assert.deepEqual((await json("/api/models/status", "GET", undefined, memberCookie)).statuses, { alpha: "online", beta: "online" });

  // Browser QA.
  const chrome = [process.env.BETA19_BROWSER_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find(candidate => candidate && existsSync(candidate));
  assert.ok(chrome, "Chrome or Edge is required for Beta 19 UI QA.");
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  const context = await browser.newContext({ viewport: { width: 1180, height: 900 }, extraHTTPHeaders: { cookie } });
  const page = await context.newPage(); const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) errors.push(message.text()); });
  await page.goto(root, { waitUntil: "domcontentloaded" });
  const trigger = page.locator(".model-trigger > span");
  await page.waitForFunction(() => document.querySelector(".model-trigger > span")?.textContent === "Alpha model");

  // The selected model's server goes offline: the picker greys it out and the selection moves to Beta.
  alpha.state.down = true; await cacheWindow();
  await page.locator(".model-trigger").click();
  const picker = page.locator(".model-popover"); await picker.waitFor();
  await picker.locator(".popover-heading small").waitFor();
  const offlineOption = picker.locator(".model-option.offline");
  await offlineOption.waitFor();
  assert.deepEqual(await offlineOption.locator("strong").allTextContents(), ["Alpha model"]);
  assert.equal(await offlineOption.getAttribute("aria-disabled"), "true");
  assert.equal(await offlineOption.getAttribute("data-tooltip"), "모델을 서빙하는 서버가 오프라인입니다");
  assert.equal(await picker.locator(".popover-heading small").textContent(), "1");
  await page.waitForFunction(() => document.querySelector(".model-trigger > span")?.textContent === "Beta model");
  const colors = await page.evaluate(() => ({ offline: getComputedStyle(document.querySelector(".model-option.offline strong")).color, online: getComputedStyle(document.querySelector(".model-option:not(.offline) strong")).color }));
  assert.notEqual(colors.offline, colors.online, "offline models are greyed out");
  await offlineOption.hover(); await delay(250);
  assert.equal(await offlineOption.evaluate(element => getComputedStyle(element, "::after").opacity), "1", "hovering shows the offline hint");
  if (shots) await page.screenshot({ path: path.join(shots, "picker-offline.png") });
  await offlineOption.click({ force: true });
  assert.equal(await picker.isVisible(), true, "an offline model cannot be chosen");
  assert.equal(await trigger.textContent(), "Beta model");
  await page.keyboard.press("Escape"); await picker.waitFor({ state: "detached" });

  // Every server offline: the trigger reads only "서버 오프라인".
  beta.state.down = true; await cacheWindow();
  await page.locator(".model-trigger").click(); await picker.waitFor();
  await page.waitForFunction(() => document.querySelector(".model-trigger > span")?.textContent === "서버 오프라인");
  await picker.locator(".model-popover-empty").waitFor();
  assert.equal(await picker.locator(".model-option.offline").count(), 2);
  if (shots) await page.screenshot({ path: path.join(shots, "picker-all-offline.png") });
  await page.keyboard.press("Escape"); await picker.waitFor({ state: "detached" });

  // Alpha returns while Beta stays down: the selection moves back to an online model.
  alpha.state.down = false; await cacheWindow();
  await page.locator(".model-trigger").click(); await picker.waitFor();
  await page.waitForFunction(() => document.querySelector(".model-trigger > span")?.textContent === "Alpha model");
  await page.keyboard.press("Escape"); await picker.waitFor({ state: "detached" });

  // Connection settings: dots, the enable switch left of delete, and a confirmed delete.
  await page.locator(".profile-settings-button").click();
  await page.locator(".settings-panel").waitFor();
  await page.locator(".settings-body nav button", { hasText: "연결" }).click();
  const dots = page.locator(".connection-editor .model-column-list .server-status-dot");
  await page.waitForFunction(() => document.querySelectorAll(".connection-editor .server-status-dot.online, .connection-editor .server-status-dot.offline").length === 2);
  const dotState = async () => dots.evaluateAll(items => items.map(item => ({ state: item.classList[1], color: getComputedStyle(item).backgroundColor })));
  assert.deepEqual(await dotState(), [{ state: "online", color: "rgb(34, 197, 94)" }, { state: "offline", color: "rgb(239, 68, 68)" }]);
  const iconBox = await page.locator(".connection-editor .model-column-list .model-type-icon").first().evaluate(element => { const icon = element.querySelector("svg").getBoundingClientRect(), dot = element.querySelector(".server-status-dot").getBoundingClientRect(); return { right: dot.left >= icon.right - 1, centred: Math.abs((dot.top + dot.bottom) / 2 - (icon.top + icon.bottom) / 2) <= 1.5 }; });
  assert.deepEqual(iconBox, { right: true, centred: true }, "the dot sits to the right of the server icon");
  const head = page.locator(".connection-card-head");
  const headButtons = await head.locator("button").evaluateAll(items => items.map(item => item.getAttribute("role") || item.className));
  assert.deepEqual(headButtons, ["switch", "connection-remove"], "the switch sits left of delete");
  const enable = head.getByRole("switch", { name: "연결 사용" });
  assert.equal(await enable.getAttribute("aria-checked"), "true");
  await enable.click();
  assert.equal(await enable.getAttribute("aria-checked"), "false");
  await page.waitForFunction(() => document.querySelector(".connection-editor .server-status-dot")?.classList.contains("disabled"));
  assert.equal(await dots.first().evaluate(item => getComputedStyle(item).backgroundColor), "rgb(113, 113, 122)");
  await page.mouse.move(0, 0); await delay(300);
  assert.equal(await enable.evaluate(item => getComputedStyle(item).backgroundColor), "rgb(60, 60, 67)", "a switched-off server shows a grey switch");
  if (shots) await page.locator(".settings-panel").screenshot({ path: path.join(shots, "connections-disabled.png") });
  const savedSettings = page.waitForResponse(response => response.url().endsWith("/api/config") && response.request().method() === "PUT" && response.ok());
  await page.locator(".settings-panel .save-button").last().click(); await savedSettings;
  assert.equal((await json("/api/config")).connections[0].disabled, true);
  assert.equal((await json("/api/models/status")).statuses.alpha, "disabled");

  // Delete asks first in the danger tone; cancelling keeps the connection.
  await head.locator(".connection-remove").click();
  const dialog = page.locator(".message-dialog-layer.tone-danger"); await dialog.waitFor();
  assert.equal(await dialog.locator("h2").textContent(), "연결 삭제");
  assert.equal(await dialog.locator(".message-dialog-body").textContent(), "이 연결을 삭제할까요?");
  if (shots) await page.screenshot({ path: path.join(shots, "connection-delete-confirm.png") });
  await dialog.locator(".secondary-button").click(); await dialog.waitFor({ state: "detached" });
  assert.equal(await page.locator(".connection-editor .model-column-list > button").count(), 2);
  await head.locator(".connection-remove").click(); await dialog.waitFor();
  await dialog.locator(".message-dialog-confirm").click(); await dialog.waitFor({ state: "detached" });
  assert.deepEqual(await page.locator(".connection-editor .model-column-list strong").allTextContents(), ["Beta"]);
  await page.locator(".settings-panel footer .secondary-button").click();

  // Models on a disabled server leave the picker entirely; with Beta down, nothing is online.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".model-trigger").click(); await picker.waitFor(); await picker.locator(".popover-heading small").waitFor();
  assert.deepEqual(await picker.locator(".model-option strong").allTextContents(), ["Beta model"]);
  await page.waitForFunction(() => document.querySelector(".model-trigger > span")?.textContent === "서버 오프라인");
  assert.deepEqual(errors, []);
  console.log("Beta 19 integration passed.");
} finally {
  await browser?.close().catch(() => undefined);
  server.kill();
  alpha.server.close(); beta.server.close();
  await delay(500);
  await rm(data, { recursive: true, force: true }).catch(() => undefined);
}
