import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import sharp from "sharp";

// Beta 20: server checks only on load, picker open and keyboard return after a minute; an orange state
// for servers that answer with an error; readable model-detection failures; select all in storage batches.
const shots = process.env.BETA20_SCREENSHOTS;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
/** A model server whose behaviour the test switches between ok, down (connection reset), html and unauthorized. */
function modelServer(model) {
  const state = { mode: "ok" };
  const server = http.createServer((request, response) => {
    if (state.mode === "down") { request.socket.destroy(); return; }
    if (state.mode === "unauthorized") { response.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Invalid API key" })); return; }
    if (state.mode === "html") { response.writeHead(200, { "Content-Type": "text/html" }).end("<!doctype html><html><body>Login</body></html>"); return; }
    if (request.method === "GET" && request.url === "/v1/models") { response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify({ object: "list", data: [{ id: model }] })); return; }
    response.writeHead(404).end();
  });
  return { server, state };
}
const alpha = modelServer("alpha-model"), beta = modelServer("beta-model");
for (const { server } of [alpha, beta]) { server.listen(0, "127.0.0.1"); await once(server, "listening"); }
const data = await mkdtemp(path.join(os.tmpdir(), "neural-beta20-"));
const reserve = http.createServer(); reserve.listen(0, "127.0.0.1"); await once(reserve, "listening");
const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
const root = `http://127.0.0.1:${port}`;
const appDir = process.env.BETA20_APP_DIR ? path.resolve(process.env.BETA20_APP_DIR) : process.cwd();
const staged = Boolean(process.env.BETA20_APP_DIR);
const runtime = process.env.BETA20_NODE || process.execPath;
const server = spawn(runtime, staged ? ["server.js"] : ["scripts/start-server.mjs", "start"], { cwd: appDir, windowsHide: true, env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: String(port), NEURAL_CHAT_DATA_DIR: data, NEURAL_CHAT_DB_PATH: path.join(data, "qa.sqlite3") }, stdio: ["ignore", "pipe", "pipe"] });
let logs = "", cookie = "", browser;
server.stdout.on("data", chunk => logs = (logs + chunk).slice(-12000));
server.stderr.on("data", chunk => logs = (logs + chunk).slice(-12000));
async function request(route, method = "GET", body) { return fetch(root + route, { method, headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60_000) }); }
async function json(route, method = "GET", body) { const response = await request(route, method, body), value = await response.json().catch(() => ({})); assert.ok(response.ok, `${method} ${route}: ${JSON.stringify(value)}`); return value; }
// Server checks are cached for five seconds, so every state change waits the cache out.
const cacheWindow = () => delay(5_300);

try {
  for (let i = 0; i < 150; i++) { try { if ((await fetch(`${root}/api/auth/status`)).ok) break; } catch {} if (i === 149) throw new Error(`Server did not start.\n${logs}`); await delay(100); }
  const setup = await request("/api/auth/setup", "POST", { username: "beta20qa", displayName: "Beta 20 QA", password: "Beta20-Local-QA-2026" }); assert.equal(setup.status, 201);
  cookie = setup.headers.get("set-cookie").split(";")[0];
  const model = (id, name, connectionId) => ({ id, sourceModel: id, name, connectionId, isAlias: false, visible: true, reasoningSupported: false, reasoningPresets: [] });
  const alphaModel = model("alpha-model", "Alpha model", "alpha"), betaModel = model("beta-model", "Beta model", "beta");
  const config = await json("/api/config");
  config.preferences.language = "ko"; config.preferences.defaultModelId = alphaModel.id;
  const betaConnection = { id: "beta", name: "Beta", driver: "openai", baseUrl: `http://127.0.0.1:${beta.server.address().port}/v1`, apiKey: "" };
  config.connections = [{ id: "alpha", name: "Alpha", driver: "openai", baseUrl: `http://127.0.0.1:${alpha.server.address().port}/v1`, apiKey: "", models: [alphaModel] }, { ...betaConnection, models: [betaModel] }];
  config.models = [alphaModel, betaModel]; config.harnessSettings.titleEnabled = false;
  await json("/api/config", "PUT", config);
  assert.deepEqual((await json("/api/models/status")).statuses, { alpha: "online", beta: "online" });

  // A server that answers badly is an error; only an unreachable one is offline.
  for (const [mode, expected] of [["html", "error"], ["unauthorized", "error"], ["down", "offline"]]) {
    beta.state.mode = mode; await cacheWindow();
    assert.equal((await json("/api/models/status")).statuses.beta, expected, mode);
  }
  // Detection failures carry a code the settings screen explains.
  for (const [mode, code] of [["unauthorized", "unauthorized"], ["html", "invalid-json"], ["down", "unreachable"]]) {
    beta.state.mode = mode;
    const response = await request("/api/models/detect", "POST", betaConnection); const body = await response.json();
    assert.equal(response.status, 502); assert.equal(body.code, code, mode);
  }
  beta.state.mode = "html"; await cacheWindow();

  // Storage fixtures: seven free files and one attached to a saved chat.
  const files = [];
  const image = await sharp({ create: { width: 32, height: 32, channels: 4, background: { r: 30, g: 80, b: 140, alpha: 1 } } }).png().toBuffer();
  const form = new FormData(); form.append("retained", "true"); form.append("files", new File([image], "beta20-in-use.png", { type: "image/png" })); form.append("thumbnail-0", new File([image], "thumbnail.png", { type: "image/png" })); form.append("dimensions-0", JSON.stringify({ width: 32, height: 32 }));
  const uploaded = await fetch(`${root}/api/uploads`, { method: "POST", headers: { cookie }, body: form }).then(response => response.json());
  files.push(uploaded.attachments[0]);
  for (let index = 1; index <= 7; index++) files.push((await json("/api/storage/files", "POST", { name: `beta20-file-${index}.txt`, kind: "text", content: `fixture ${index}` })).attachment);
  const stamp = new Date().toISOString();
  await json("/api/conversations", "POST", { id: "beta20-chat", title: "Beta 20 chat", modelId: alphaModel.id, activeBranchId: "beta20-main", createdAt: stamp, updatedAt: stamp, branches: [{ id: "beta20-main", name: "Main", createdAt: stamp, updatedAt: stamp, messages: [{ id: "beta20-user", role: "user", content: "hello", attachments: [files[0]], createdAt: stamp }] }] });
  assert.equal((await json("/api/storage?page=1&pageSize=20")).files.filter(file => file.referenceCount > 0).length, 1);

  const chrome = [process.env.BETA20_BROWSER_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find(candidate => candidate && existsSync(candidate));
  assert.ok(chrome, "Chrome or Edge is required for Beta 20 UI QA.");
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  const context = await browser.newContext({ viewport: { width: 1180, height: 900 }, extraHTTPHeaders: { cookie } });
  const page = await context.newPage(); const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) errors.push(message.text()); });
  let checks = 0;
  page.on("request", item => { if (item.method() === "GET" && new URL(item.url()).pathname === "/api/models/status") checks++; });
  const settle = async expected => { for (let i = 0; i < 40 && checks < expected; i++) await delay(100); await delay(400); return checks; };
  await page.clock.install();
  await page.goto(root, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector(".model-trigger > span")?.textContent === "Alpha model");
  assert.equal(await settle(1), 1, "servers are checked once when the page loads");

  // No timer: 35 seconds pass without any request.
  await page.clock.fastForward(35_000);
  assert.equal(await settle(1), 1, "no periodic server check");
  // A key within the minute does nothing; the first key after a quiet minute checks once.
  await page.keyboard.press("Shift");
  assert.equal(await settle(1), 1, "typing within the minute does not check");
  await page.clock.fastForward(61_000);
  await page.keyboard.press("Shift");
  assert.equal(await settle(2), 2, "the first key after a quiet minute checks the servers");
  await page.keyboard.press("Shift");
  assert.equal(await settle(2), 2, "continued typing does not check again");

  // Opening the picker checks once; Beta answers with an error and stays selectable with an orange mark.
  await page.locator(".model-trigger").click();
  const picker = page.locator(".model-popover"); await picker.waitFor();
  assert.equal(await settle(3), 3, "opening the picker checks the servers");
  const errorOption = picker.locator(".model-option.server-error"); await errorOption.waitFor();
  assert.deepEqual(await errorOption.locator("strong").allTextContents(), ["Beta model"]);
  assert.equal(await errorOption.getAttribute("aria-disabled"), null);
  assert.equal(await errorOption.getAttribute("data-tooltip"), "모델을 서빙하는 서버에서 오류가 발생했습니다");
  assert.equal(await errorOption.evaluate(element => getComputedStyle(element.querySelector("strong"), "::after").backgroundColor), "rgb(249, 115, 22)");
  if (shots) await page.screenshot({ path: path.join(shots, "picker-server-error.png") });
  await page.keyboard.press("Escape"); await picker.waitFor({ state: "detached" });
  assert.equal(await settle(3), 3, "closing the picker does not check");

  // Connection settings: the erroring server's dot is orange and a failed detection opens a danger dialog.
  await page.locator(".profile-settings-button").click();
  await page.locator(".settings-panel").waitFor();
  await page.locator(".settings-body nav button", { hasText: "연결" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".connection-editor .server-status-dot.online, .connection-editor .server-status-dot.error").length === 2);
  const dots = await page.locator(".connection-editor .model-column-list .server-status-dot").evaluateAll(items => items.map(item => ({ state: item.classList[1], color: getComputedStyle(item).backgroundColor, label: item.getAttribute("aria-label") })));
  assert.deepEqual(dots, [{ state: "online", color: "rgb(34, 197, 94)", label: "온라인" }, { state: "error", color: "rgb(249, 115, 22)", label: "온라인이지만 오류 발생" }]);
  await page.locator(".connection-editor .model-column-list > button", { hasText: "Beta" }).click();
  await page.locator(".connection-test button").click();
  const dialog = page.locator(".message-dialog-layer.tone-danger"); await dialog.waitFor();
  assert.equal(await dialog.locator("h2").textContent(), "모델 감지 실패");
  assert.match(await dialog.locator(".message-dialog-body").textContent(), /JSON 형식이 아닙니다/);
  assert.match(await dialog.locator(".message-dialog-detail").textContent(), /text\/html/);
  assert.doesNotMatch(await page.locator(".settings-panel").textContent(), /JSON\.parse|Unexpected token/);
  if (shots) await page.screenshot({ path: path.join(shots, "detect-failed.png") });
  await dialog.locator(".message-dialog-confirm").click(); await dialog.waitFor({ state: "detached" });
  assert.equal(await page.locator(".settings-panel footer > span").textContent(), "모델 감지에 실패했습니다.");
  await page.locator(".settings-panel footer .secondary-button").click();

  // Storage manager: select all in batch mode selects every file, then deletion skips the one in use.
  await page.getByRole("button", { name: "저장소 관리" }).first().click();
  await page.locator(".storage-file-grid article").first().waitFor();
  await page.locator(".storage-batch-button").click();
  const toolbar = page.locator(".storage-delete-toolbar");
  await toolbar.getByRole("button", { name: "전체 선택" }).click();
  await toolbar.getByText("8개 선택됨").waitFor();
  assert.equal(await toolbar.getByRole("button", { name: "전체 해제" }).getAttribute("aria-pressed"), "true");
  if (shots) await page.screenshot({ path: path.join(shots, "storage-select-all.png") });
  await toolbar.getByRole("button", { name: "전체 해제" }).click();
  await toolbar.getByText("0개 선택됨").waitFor();
  await toolbar.getByRole("button", { name: "전체 선택" }).click();
  await toolbar.getByText("8개 선택됨").waitFor();
  await toolbar.getByRole("button", { name: "선택 항목 삭제" }).click();
  await page.getByText("7개 파일을 삭제했습니다. 채팅에서 사용 중인 1개 파일은 건너뛰었습니다.").waitFor();
  const remaining = await json("/api/storage?page=1&pageSize=20");
  assert.deepEqual(remaining.files.map(file => file.id), [files[0].id]);
  await toolbar.getByText("1개 선택됨").waitFor();
  // At phone width the three toolbar buttons still fit without overflowing.
  await page.setViewportSize({ width: 390, height: 844 }); await delay(300);
  const fit = await toolbar.evaluate(element => ({ fits: element.scrollWidth <= element.clientWidth + 1, buttons: [...element.querySelectorAll(":scope > button")].every(button => button.getBoundingClientRect().right <= element.getBoundingClientRect().right + 1), clear: (() => { const label = element.querySelector("strong").getBoundingClientRect(); return [...element.querySelectorAll(":scope > button")].every(button => { const box = button.getBoundingClientRect(); return box.left >= label.right || box.top >= label.bottom; }); })() }));
  assert.deepEqual(fit, { fits: true, buttons: true, clear: true }, "the batch toolbar fits a phone screen");
  if (shots) await page.screenshot({ path: path.join(shots, "storage-select-all-mobile.png") });
  assert.deepEqual(errors, []);
  console.log("Beta 20 integration passed.");
} catch (error) { console.error(logs); throw error; } finally {
  await browser?.close().catch(() => undefined);
  server.kill();
  alpha.server.close(); beta.server.close();
  await delay(500);
  await rm(data, { recursive: true, force: true }).catch(() => undefined);
}
