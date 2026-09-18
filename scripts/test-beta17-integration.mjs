import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

// Beta 17: live/weighted plan usage, usage colours and manual refresh, offline model servers,
// account-saved tool switches, two-decimal weights and workspace-wide weight badges.
const shots = process.env.BETA17_SCREENSHOTS;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const inference = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/v1/models") { response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify({ data: [{ id: "qa-model" }] })); return; }
  if (request.method === "POST" && request.url === "/v1/chat/completions") {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    // Streams slowly and reports usage only at the end, so a mid-stream usage request must use the live estimate.
    for (let index = 0; index < 14; index++) { response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "streamed words " }, finish_reason: null }] })}\n\n`); await delay(150); }
    response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 } })}\n\n`);
    response.end("data: [DONE]\n\n"); return;
  }
  response.writeHead(404).end();
});
inference.listen(0, "127.0.0.1"); await once(inference, "listening");
const inferencePort = inference.address().port;
const closed = http.createServer(); closed.listen(0, "127.0.0.1"); await once(closed, "listening");
const offlinePort = closed.address().port; await new Promise(resolve => closed.close(resolve));
const data = await mkdtemp(path.join(os.tmpdir(), "neural-beta17-"));
const reserve = http.createServer(); reserve.listen(0, "127.0.0.1"); await once(reserve, "listening");
const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
const root = `http://127.0.0.1:${port}`;
const appDir = process.env.BETA17_APP_DIR ? path.resolve(process.env.BETA17_APP_DIR) : process.cwd();
const staged = Boolean(process.env.BETA17_APP_DIR);
const runtime = process.env.BETA17_NODE || process.execPath;
const server = spawn(runtime, staged ? ["server.js"] : ["scripts/start-server.mjs", "start"], { cwd: appDir, windowsHide: true, env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: String(port), NEURAL_CHAT_DATA_DIR: data, NEURAL_CHAT_DB_PATH: path.join(data, "qa.sqlite3") }, stdio: ["ignore", "pipe", "pipe"] });
let logs = "", cookie = "", browser;
server.stdout.on("data", chunk => logs = (logs + chunk).slice(-12000));
server.stderr.on("data", chunk => logs = (logs + chunk).slice(-12000));
async function request(route, method = "GET", body, jar = cookie) { return fetch(root + route, { method, headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(jar ? { cookie: jar } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60_000) }); }
async function json(route, method = "GET", body, jar = cookie) { const response = await request(route, method, body, jar), value = await response.json().catch(() => ({})); assert.ok(response.ok, `${method} ${route}: ${JSON.stringify(value)}`); return value; }

try {
  for (let i = 0; i < 150; i++) { try { if ((await fetch(`${root}/api/auth/status`)).ok) break; } catch {} if (i === 149) throw new Error(`Server did not start.\n${logs}`); await delay(100); }
  const password = "Beta17-Local-QA-2026";
  const setup = await request("/api/auth/setup", "POST", { username: "beta17qa", displayName: "Beta 17 QA", password }); assert.equal(setup.status, 201);
  cookie = setup.headers.get("set-cookie").split(";")[0];
  const online = { id: "qa-model", sourceModel: "qa-model", name: "QA model", connectionId: "qa", isAlias: false, visible: true, reasoningSupported: false, reasoningPresets: [] };
  const offline = { id: "down-model", sourceModel: "down-model", name: "Down model", connectionId: "down", isAlias: false, visible: true, reasoningSupported: false, reasoningPresets: [] };
  const config = await json("/api/config");
  config.preferences.language = "ko";
  config.connections = [{ id: "qa", name: "QA", driver: "openai", baseUrl: `http://127.0.0.1:${inferencePort}/v1`, apiKey: "", models: [online] }, { id: "down", name: "Down", driver: "openai", baseUrl: `http://127.0.0.1:${offlinePort}/v1`, apiKey: "", models: [offline] }];
  config.models = [online, offline]; config.harnessSettings.titleEnabled = false;
  await json("/api/config", "PUT", config);

  // Offline servers are reported so the picker can grey out their models (beta 19; beta 17 hid them).
  assert.deepEqual((await json("/api/models/status")).offlineConnectionIds, ["down"]);

  // Weights accept two decimal places and reject a third.
  const planBody = { name: "Weighted QA", storageQuotaBytes: 1024 ** 3, servedModelIds: [], modelWeights: { "qa-model": 1.75 }, tokenLimits: [{ durationSeconds: 10800, tokenLimit: 100, tokenScope: "both" }] };
  assert.equal((await request("/api/plans", "POST", { ...planBody, modelWeights: { "qa-model": 1.755 } })).status, 400);
  const plan = (await json("/api/plans", "POST", planBody)).plan;
  assert.equal(plan.modelWeights["qa-model"], 1.75);
  const self = (await json("/api/users?q=beta17qa")).users[0];
  await json(`/api/users/${self.id}`, "PATCH", { planId: plan.id });

  // While the workspace switch is off, no account receives plan weights.
  assert.equal((await json("/api/config")).showModelWeights, false);
  assert.equal((await json("/api/config")).modelWeights, undefined);
  assert.equal((await request("/api/users", "POST", { username: "beta17user", displayName: "Beta 17 User", password })).status, 201);
  const member = (await json("/api/users?q=beta17user")).users[0];
  await json(`/api/users/${member.id}`, "PATCH", { planId: plan.id });
  const login = await request("/api/auth/login", "POST", { username: "beta17user", password }, "");
  assert.ok(login.ok); const memberCookie = login.headers.get("set-cookie").split(";")[0];
  const memberConfig = await json("/api/config", "GET", undefined, memberCookie);
  assert.equal(memberConfig.modelWeights, undefined);
  memberConfig.showModelWeights = true;
  await json("/api/config", "PUT", memberConfig, memberCookie);
  assert.equal((await json("/api/config", "GET", undefined, memberCookie)).showModelWeights, false, "a standard account cannot change the workspace switch");

  // Tool switches are saved on the account and survive a settings save.
  const saved = await json("/api/preferences/tools", "PUT", { internetSearch: true, storageAccess: false, bogus: true });
  assert.equal(saved.enabledTools.internetSearch, true); assert.equal("bogus" in saved.enabledTools, false);
  const beforeSave = await json("/api/config");
  await json("/api/config", "PUT", beforeSave);
  const afterSave = await json("/api/config");
  assert.equal(afterSave.preferences.enabledTools.internetSearch, true);
  assert.equal(afterSave.preferences.enabledTools.storageAccess, false);
  assert.equal(afterSave.preferences.enabledTools.currentTime, true);
  assert.equal((await json("/api/config", "GET", undefined, memberCookie)).preferences.enabledTools.internetSearch, false, "tool switches are per account");
  await json("/api/preferences/tools", "PUT", { internetSearch: false, storageAccess: true });

  // A usage request during streaming includes the tokens produced so far.
  const stamp = new Date().toISOString();
  await json("/api/conversations", "POST", { id: "beta17-chat", title: "Beta 17 chat", modelId: online.id, activeBranchId: "beta17-main", createdAt: stamp, updatedAt: stamp, branches: [{ id: "beta17-main", name: "Main", createdAt: stamp, updatedAt: stamp, messages: [{ id: "beta17-user", role: "user", content: "hello", createdAt: stamp }] }] });
  const job = await request("/api/chat", "POST", { conversationId: "beta17-chat", branchId: "beta17-main", assistantMessageId: "beta17-assistant", modelId: online.id, messages: [{ role: "user", content: "hello" }] });
  assert.equal(job.status, 202);
  let finished = false; const stream = request("/api/chat/beta17-chat").then(response => response.text()).finally(() => { finished = true; });
  let liveUsed = 0;
  while (!finished) { const usage = await json("/api/usage"); if (!finished) liveUsed = Math.max(liveUsed, usage.windows[0].usedTokens); await delay(200); }
  await stream;
  assert.ok(liveUsed > 0, "a mid-stream refresh shows the running response");
  const recorded = await json("/api/usage");
  assert.equal(recorded.windows[0].usedTokens, 88, "50 reported tokens at weight 1.75");
  assert.equal(Math.round(recorded.nearestPercentage), 88);

  // Browser QA.
  const chrome = [process.env.BETA17_BROWSER_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find(candidate => candidate && existsSync(candidate));
  assert.ok(chrome, "Chrome or Edge is required for Beta 17 UI QA.");
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  const context = await browser.newContext({ viewport: { width: 1180, height: 900 }, extraHTTPHeaders: { cookie } });
  const page = await context.newPage(); const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) errors.push(message.text()); });
  await page.goto(root, { waitUntil: "domcontentloaded" });
  await page.locator(".usage-donut[data-level='warning']").waitFor();
  await page.locator(".usage-donut-button").click();
  const popover = page.locator(".usage-popover"); await popover.waitFor();
  const actions = popover.locator(".usage-popover-actions button");
  assert.equal(await actions.count(), 2);
  assert.equal(await actions.nth(0).getAttribute("aria-label"), "사용량 새로고침");
  assert.equal(await actions.nth(1).getAttribute("aria-label"), "닫기");
  const bar = popover.locator(".usage-window-list em").first();
  assert.equal(await bar.evaluate(element => getComputedStyle(element).backgroundColor), "rgb(245, 197, 66)");
  const refreshed = page.waitForResponse(response => response.url().endsWith("/api/usage") && response.request().method() === "GET");
  await actions.nth(0).click(); await refreshed;
  if (shots) await page.screenshot({ path: path.join(shots, "usage-popover.png") });
  await actions.nth(1).click(); await popover.waitFor({ state: "detached" });

  // Offline models are greyed out; weight badges stay hidden until an administrator enables them.
  await page.locator(".model-trigger").click();
  const picker = page.locator(".model-popover"); await picker.waitFor();
  await picker.locator(".popover-heading small").waitFor();
  assert.deepEqual(await picker.locator(".model-option:not(.offline) strong").allTextContents(), ["QA model"]);
  assert.deepEqual(await picker.locator(".model-option.offline strong").allTextContents(), ["Down model"]);
  assert.equal(await picker.locator(".model-weight-badge").count(), 0);
  await page.keyboard.press("Escape");
  await page.locator(".profile-settings-button").click();
  await page.locator(".settings-panel").waitFor();
  await page.locator(".settings-body nav button", { hasText: "모양" }).click();
  const weightSwitch = page.getByRole("switch", { name: "모델 가중치 표시" });
  assert.equal(await weightSwitch.getAttribute("aria-checked"), "false");
  await weightSwitch.click();
  const savedSettings = page.waitForResponse(response => response.url().endsWith("/api/config") && response.request().method() === "PUT" && response.ok());
  await page.locator(".settings-panel .save-button").last().click(); await savedSettings;
  assert.equal((await json("/api/config")).showModelWeights, true);
  // Scrolling past a focused weight field must not step its value.
  await page.locator(".settings-body nav button", { hasText: "플랜" }).click();
  await page.locator(".plan-list button", { hasText: "Weighted QA" }).click();
  const weightField = page.locator(".plan-models input[type=number]").first();
  await weightField.click({ clickCount: 3 }); await page.keyboard.type("1.35", { delay: 30 });
  await weightField.hover(); for (let tick = 0; tick < 24; tick++) await page.mouse.wheel(0, 100);
  assert.equal(await weightField.inputValue(), "1.35");
  const savedPlan = page.waitForResponse(response => response.url().endsWith(`/api/plans/${plan.id}`) && response.request().method() === "PUT" && response.ok());
  await page.getByRole("button", { name: "플랜 저장" }).click(); await savedPlan;
  assert.equal((await json("/api/plans")).plans.find(item => item.id === plan.id).modelWeights["qa-model"], 1.35);
  await weightField.click({ clickCount: 3 }); await page.keyboard.type("1.75", { delay: 30 }); await page.keyboard.press("ArrowUp"); await page.keyboard.press("ArrowDown");
  const restoredPlan = page.waitForResponse(response => response.url().endsWith(`/api/plans/${plan.id}`) && response.request().method() === "PUT" && response.ok());
  await page.getByRole("button", { name: "플랜 저장" }).click(); await restoredPlan;
  assert.equal((await json("/api/plans")).plans.find(item => item.id === plan.id).modelWeights["qa-model"], 1.75);
  assert.deepEqual((await json("/api/config")).modelWeights, { "qa-model": 1.75 }, "the enabling administrator sees badges");
  assert.deepEqual((await json("/api/config", "GET", undefined, memberCookie)).modelWeights, { "qa-model": 1.75 }, "standard accounts see badges too");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".model-trigger").click(); await picker.locator(".popover-heading small").waitFor();
  const badge = picker.locator(".model-weight-badge");
  assert.equal(await badge.textContent(), "x1.75");
  const layout = await badge.evaluate(element => { const option = element.closest(".model-option").getBoundingClientRect(), box = element.getBoundingClientRect(); return { color: getComputedStyle(element).color, offset: Math.abs((box.top + box.bottom) / 2 - (option.top + option.bottom) / 2) }; });
  assert.equal(layout.color, "rgb(139, 142, 149)"); assert.ok(layout.offset <= 1, `badge is vertically centred (${layout.offset}px)`);
  await badge.hover(); await delay(250);
  if (shots) await page.screenshot({ path: path.join(shots, "model-picker.png") });
  const tooltip = await badge.evaluate(element => { const style = getComputedStyle(element, "::after"); return { content: style.content, opacity: style.opacity }; });
  assert.equal(tooltip.content, "\"토큰을 1.75배 더 빨리 소모합니다\""); assert.equal(tooltip.opacity, "1");
  await page.keyboard.press("Escape");

  // A composer tool switch survives a reload.
  await page.locator("button[title='추가']").first().click();
  const search = page.getByRole("switch", { name: "인터넷 검색" }).first();
  assert.equal(await search.getAttribute("aria-checked"), "false");
  const persisted = page.waitForResponse(response => response.url().endsWith("/api/preferences/tools") && response.ok());
  await search.click(); await persisted;
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".usage-donut").waitFor();
  await page.locator("button[title='추가']").first().click();
  await page.waitForFunction(() => document.querySelector("[role='switch'][aria-label='인터넷 검색']")?.getAttribute("aria-checked") === "true");
  assert.equal((await json("/api/config")).preferences.enabledTools.internetSearch, true);
  // A standard account sees the same badge in its own picker.
  const memberContext = await browser.newContext({ viewport: { width: 1180, height: 900 }, extraHTTPHeaders: { cookie: memberCookie } });
  const memberPage = await memberContext.newPage();
  memberPage.on("pageerror", error => errors.push(error.message));
  await memberPage.goto(root, { waitUntil: "domcontentloaded" });
  await memberPage.locator(".model-trigger").click();
  await memberPage.locator(".model-popover .popover-heading small").waitFor();
  assert.equal(await memberPage.locator(".model-popover .model-weight-badge").textContent(), "x1.75");
  if (shots) await memberPage.screenshot({ path: path.join(shots, "member-picker.png") });
  assert.deepEqual(errors, []);
  console.log("Beta 17 integration passed.");
} finally {
  await browser?.close().catch(() => {});
  server.kill(); await once(server, "exit").catch(() => {});
  await new Promise(resolve => inference.close(resolve));
  await rm(data, { recursive: true, force: true }).catch(() => {});
}
