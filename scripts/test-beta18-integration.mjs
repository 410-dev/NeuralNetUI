import assert from "node:assert/strict";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright-core";
import { decryptBackup, encryptBackup } from "../lib/backup-crypto.ts";

// Beta 18: reset credits empty covered windows until the next use, personal backups carry model settings and
// restore them best-effort across accounts and image variants, and delete prompts use the red tone.
const shots = process.env.BETA18_SCREENSHOTS;
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const inference = http.createServer((request, response) => {
  if (request.method === "GET" && request.url === "/v1/models") { response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify({ data: [{ id: "qa-model" }, { id: "qa-other" }] })); return; }
  response.writeHead(404).end();
});
inference.listen(0, "127.0.0.1"); await once(inference, "listening");
const inferencePort = inference.address().port;
const data = await mkdtemp(path.join(os.tmpdir(), "neural-beta18-"));
const reserve = http.createServer(); reserve.listen(0, "127.0.0.1"); await once(reserve, "listening");
const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
const root = `http://127.0.0.1:${port}`;
const appDir = process.env.BETA18_APP_DIR ? path.resolve(process.env.BETA18_APP_DIR) : process.cwd();
const staged = Boolean(process.env.BETA18_APP_DIR);
const runtime = process.env.BETA18_NODE || process.execPath;
const dbPath = path.join(data, "qa.sqlite3");
const sevenZip = path.join(process.cwd(), "node_modules", "7zip-bin", process.platform === "win32" ? path.join("win", process.arch, "7za.exe") : path.join(process.platform === "darwin" ? "mac" : "linux", process.arch, "7za"));
const server = spawn(runtime, staged ? ["server.js"] : ["scripts/start-server.mjs", "start"], { cwd: appDir, windowsHide: true, env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: String(port), NEURAL_CHAT_DATA_DIR: data, NEURAL_CHAT_DB_PATH: dbPath }, stdio: ["ignore", "pipe", "pipe"] });
let logs = "", cookie = "", browser;
server.stdout.on("data", chunk => logs = (logs + chunk).slice(-12000));
server.stderr.on("data", chunk => logs = (logs + chunk).slice(-12000));
async function request(route, method = "GET", body, jar = cookie, headers = {}) { const raw = body instanceof Uint8Array; return fetch(root + route, { method, headers: { ...(body === undefined || raw ? {} : { "Content-Type": "application/json" }), ...(jar ? { cookie: jar } : {}), ...headers }, ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }), signal: AbortSignal.timeout(60_000) }); }
async function json(route, method = "GET", body, jar = cookie, headers = {}) { const response = await request(route, method, body, jar, headers), value = await response.json().catch(() => ({})); assert.ok(response.ok, `${method} ${route}: ${JSON.stringify(value)}`); return value; }
const db = () => new Database(dbPath, { readonly: true, fileMustExist: true });
const read = callback => { const connection = db(); try { return callback(connection); } finally { connection.close(); } };
const config = () => read(connection => JSON.parse(connection.prepare("SELECT value FROM app_config WHERE id=1").get().value));
const preferences = userId => read(connection => JSON.parse(connection.prepare("SELECT preferences FROM users WHERE id=?").get(userId).preferences));
const password = "Beta18-Local-QA-2026";
const credentials = username => ({ "X-Backup-Credentials": encodeURIComponent(JSON.stringify({ username, password })) });
async function backup(jar, username, scope = "personal", userId) {
  const response = await request(`/api/backup?scope=${scope}${userId ? `&userId=${userId}` : ""}`, "GET", undefined, jar, credentials(username));
  assert.ok(response.ok, await response.clone().text());
  return new Uint8Array(await response.arrayBuffer());
}
const restore = (jar, username, bytes, mode, scope = "personal", userId) => json("/api/backup", "POST", bytes, jar, { ...credentials(username), "X-Backup-Scope": scope, "X-Restore-Mode": mode, ...(userId ? { "X-Target-User-Id": userId } : {}) });
async function editImage(bytes, username, edit) {
  const work = path.join(data, `repack-${randomUUID()}`), unpacked = path.join(work, "x"), secret = { username, password };
  mkdirSync(unpacked, { recursive: true }); writeFileSync(path.join(work, "in.nnbak"), bytes);
  await decryptBackup(path.join(work, "in.nnbak"), path.join(work, "in.7z"), secret);
  assert.equal(spawnSync(sevenZip, ["x", "-y", `-o${unpacked}`, path.join(work, "in.7z")]).status, 0);
  const file = path.join(unpacked, "data.json"), value = JSON.parse(readFileSync(file, "utf8")); edit(value); writeFileSync(file, JSON.stringify(value));
  assert.equal(spawnSync(sevenZip, ["a", "-t7z", path.join(work, "out.7z"), "."], { cwd: unpacked }).status, 0);
  await encryptBackup(path.join(work, "out.7z"), path.join(work, "out.nnbak"), secret);
  return new Uint8Array(readFileSync(path.join(work, "out.nnbak")));
}
const alias = (id, name, presetId) => ({ id, name, sourceModel: "qa-model", isAlias: true, visible: true, reasoningSupported: false, reasoningPresets: [{ id: presetId, name: `${name} template`, kind: "custom", systemPrompt: "Be brief", systemPromptMode: "append" }] });

try {
  for (let i = 0; i < 150; i++) { try { if ((await fetch(`${root}/api/auth/status`)).ok) break; } catch {} if (i === 149) throw new Error(`Server did not start.\n${logs}`); await delay(100); }
  const setup = await request("/api/auth/setup", "POST", { username: "beta18qa", displayName: "Beta 18 QA", password }); assert.equal(setup.status, 201);
  cookie = setup.headers.get("set-cookie").split(";")[0];
  const served = (id, name) => ({ id, sourceModel: id, name, connectionId: "qa", isAlias: false, visible: true, reasoningSupported: false, reasoningPresets: [] });
  const initial = await json("/api/config");
  initial.preferences.language = "ko";
  initial.connections = [{ id: "qa", name: "QA", driver: "openai", baseUrl: `http://127.0.0.1:${inferencePort}/v1`, apiKey: "", models: [served("qa-model", "QA model"), served("qa-other", "QA other")] }];
  initial.models = [served("qa-model", "QA model"), served("qa-other", "QA other")]; initial.harnessSettings.titleEnabled = false;
  await json("/api/config", "PUT", initial);
  const admin = (await json("/api/users?q=beta18qa")).users[0];
  for (const username of ["beta18user", "beta18peer"]) assert.equal((await request("/api/users", "POST", { username, displayName: username, password })).status, 201);
  const member = (await json("/api/users?q=beta18user")).users[0], peer = (await json("/api/users?q=beta18peer")).users[0];
  const login = async username => { const response = await request("/api/auth/login", "POST", { username, password }, ""); assert.ok(response.ok); return response.headers.get("set-cookie").split(";")[0]; };
  const memberCookie = await login("beta18user"), peerCookie = await login("beta18peer");

  // ---- Reset credits empty covered windows; they restart at the next use --------------------------------
  const plan = (await json("/api/plans", "POST", { name: "Reset QA", storageQuotaBytes: 1024 ** 3, servedModelIds: [], modelWeights: {}, tokenLimits: [{ durationSeconds: 3 * 3600, tokenLimit: 100, tokenScope: "both" }, { durationSeconds: 5 * 3600, tokenLimit: 200, tokenScope: "both" }, { durationSeconds: 10 * 3600, tokenLimit: 500, tokenScope: "both" }] })).plan;
  await json(`/api/users/${member.id}`, "PATCH", { planId: plan.id });
  const usageDb = new Database(dbPath);
  usageDb.prepare("INSERT INTO token_usage_events(user_id,model_id,input_tokens,output_tokens,created_at) VALUES(?,?,?,?,?)").run(member.id, "qa-model", 60, 40, new Date(Date.now() - 60_000).toISOString());
  const before = await json("/api/usage", "GET", undefined, memberCookie);
  assert.deepEqual(before.windows.map(item => Math.round(item.percentage)), [100, 50, 20]);
  assert.equal(before.blocked, true);
  await json("/api/reset-credits", "POST", { targetType: "user", targetId: member.id, maxWindowSeconds: 5 * 3600, expiresAt: new Date(Date.now() + 86400_000).toISOString(), title: "Five hours" });
  const credit = (await json("/api/usage", "GET", undefined, memberCookie)).credits[0];
  const after = await json("/api/usage", "POST", { creditId: credit.id }, memberCookie);
  assert.deepEqual(after.windows.map(item => Math.round(item.percentage)), [0, 0, 20], "3h and 5h reset; 10h keeps its usage");
  assert.equal(after.blocked, false);
  assert.equal(after.windows[0].startsAt, undefined, "a reset window waits for the next use");
  assert.equal(after.windows[1].startsAt, undefined);
  assert.deepEqual([after.windows[2].startsAt, after.windows[2].resetsAt], [before.windows[2].startsAt, before.windows[2].resetsAt], "the 10h window keeps its timing");
  await delay(20);
  const nextUse = new Date().toISOString();
  usageDb.prepare("INSERT INTO token_usage_events(user_id,model_id,input_tokens,output_tokens,created_at) VALUES(?,?,?,?,?)").run(member.id, "qa-model", 10, 0, nextUse);
  usageDb.close();
  const resumed = await json("/api/usage", "GET", undefined, memberCookie);
  assert.deepEqual(resumed.windows.map(item => item.usedTokens), [10, 10, 110], "new usage counts in every window");
  assert.deepEqual(resumed.windows.slice(0, 2).map(item => [item.startsAt, item.resetsAt]), [[nextUse, new Date(Date.parse(nextUse) + 3 * 3600_000).toISOString()], [nextUse, new Date(Date.parse(nextUse) + 5 * 3600_000).toISOString()]], "reset windows start at the first use after the reset");
  assert.deepEqual([resumed.windows[2].startsAt, resumed.windows[2].resetsAt], [before.windows[2].startsAt, before.windows[2].resetsAt]);

  // ---- Personal backups carry model settings -----------------------------------------------------
  const adminConfig = await json("/api/config");
  adminConfig.models = adminConfig.models.map(model => model.id === "qa-model" ? { ...model, name: "QA model saved", description: "Saved description", reasoningPresets: [...model.reasoningPresets, { id: "admin-template", name: "Admin template", kind: "custom", systemPromptMode: "append" }] } : model);
  adminConfig.models.push(alias("admin-alias", "Admin alias", "admin-alias-template"));
  adminConfig.preferences.defaultModelId = "admin-alias";
  await json("/api/config", "PUT", adminConfig);
  const memberConfig = await json("/api/config", "GET", undefined, memberCookie);
  memberConfig.models.push(alias("member-alias", "Member alias", "member-template"));
  memberConfig.preferences.defaultModelId = "member-alias"; memberConfig.preferences.defaultReasoningPresetId = "member-template";
  await json("/api/config", "PUT", memberConfig, memberCookie);
  assert.equal(config().models.find(model => model.id === "member-alias").reasoningPresets.find(preset => preset.id === "member-template").ownerId, member.id, "a standard account keeps its own alias templates");
  assert.ok((await json("/api/config", "GET", undefined, memberCookie)).models.find(model => model.id === "member-alias").reasoningPresets.some(preset => preset.id === "member-template"));
  const stamp = new Date().toISOString();
  await json("/api/conversations", "POST", { id: "beta18-chat", title: "Beta 18 chat", modelId: "member-alias", activeBranchId: "beta18-main", createdAt: stamp, updatedAt: stamp, branches: [{ id: "beta18-main", name: "Main", createdAt: stamp, updatedAt: stamp, messages: [{ id: "beta18-user", role: "user", content: "delete me", createdAt: stamp }, { id: "beta18-reply", role: "assistant", content: "reply", createdAt: stamp }] }] }, memberCookie);
  const memberImage = await backup(memberCookie, "beta18user");
  const adminImage = await backup(cookie, "beta18qa");
  const stored = [];
  await editImage(memberImage, "beta18user", value => stored.push(value.modelSettings));
  assert.equal(stored[0].settings.format, "neuralnetui-model-settings");
  assert.deepEqual(stored[0].ownedModelIds, ["member-alias"]);
  assert.equal(stored[0].settings.models.some(model => model.id === "admin-alias"), false, "private aliases of others are not exported");

  // The member loses its alias, then merges it back from the image.
  const trimmed = await json("/api/config", "GET", undefined, memberCookie);
  trimmed.models = trimmed.models.filter(model => model.id !== "member-alias"); trimmed.preferences.defaultModelId = "qa-model"; delete trimmed.preferences.defaultReasoningPresetId;
  await json("/api/config", "PUT", trimmed, memberCookie);
  assert.equal(config().models.some(model => model.id === "member-alias"), false);
  const merged = await restore(memberCookie, "beta18user", memberImage, "merge");
  assert.deepEqual(merged.modelSettings, { status: "restored", aliases: 1, presets: 0, servedModels: 0, skipped: 0 });
  const restoredAlias = config().models.find(model => model.id === "member-alias");
  assert.equal(restoredAlias.ownerId, member.id);
  assert.deepEqual(restoredAlias.reasoningPresets.filter(preset => preset.kind === "custom").map(preset => [preset.id, preset.ownerId]), [["member-template", member.id]]);
  assert.equal(preferences(member.id).defaultModelId, "member-alias");
  const memberView = await json("/api/config", "GET", undefined, memberCookie);
  assert.equal(memberView.preferences.defaultModelId, "member-alias");
  assert.ok(memberView.models.some(model => model.id === "member-alias"));
  assert.equal(config().models.find(model => model.id === "qa-model").name, "QA model saved", "a standard account never changes served models");

  // An administrator's replace restore brings back served-model settings and private templates.
  const changed = await json("/api/config");
  changed.models = changed.models.filter(model => model.id !== "admin-alias").map(model => model.id === "qa-model" ? { ...model, name: "Changed", description: "", reasoningPresets: model.reasoningPresets.filter(preset => preset.id !== "admin-template").concat({ id: "stale-template", name: "Stale", kind: "custom", systemPromptMode: "append" }) } : model);
  changed.models = [...changed.models.filter(model => model.id === "qa-other"), ...changed.models.filter(model => model.id !== "qa-other")];
  await json("/api/config", "PUT", changed);
  const replaced = await restore(cookie, "beta18qa", adminImage, "replace");
  assert.equal(replaced.modelSettings.status, "restored");
  assert.equal(replaced.modelSettings.aliases, 1); assert.equal(replaced.modelSettings.presets, 1); assert.equal(replaced.modelSettings.servedModels, 2);
  const adminAfter = config();
  const qa = adminAfter.models.find(model => model.id === "qa-model");
  assert.equal(qa.name, "QA model saved"); assert.equal(qa.description, "Saved description");
  assert.deepEqual(qa.reasoningPresets.filter(preset => preset.kind === "custom").map(preset => preset.id), ["admin-template"], "stale private templates are replaced");
  assert.equal(adminAfter.models.find(model => model.id === "admin-alias").ownerId, admin.id);
  assert.equal(adminAfter.models.find(model => model.id === "member-alias").ownerId, member.id, "other accounts keep their aliases");
  assert.deepEqual(adminAfter.models.filter(model => !model.isAlias).map(model => model.id), ["qa-model", "qa-other"], "saved order is restored");
  assert.equal(adminAfter.connections[0].models.find(model => model.id === "qa-model").name, "QA model saved");

  // Another account restores the member's image: the alias gets a private id that its chat follows.
  const cross = await restore(cookie, "beta18user", memberImage, "merge", "user", peer.id);
  assert.equal(cross.modelSettings.aliases, 1);
  const peerAlias = config().models.find(model => model.ownerId === peer.id);
  assert.match(peerAlias.id, /^alias-[0-9a-f]{24}$/);
  assert.equal(peerAlias.name, "Member alias");
  assert.equal(preferences(peer.id).defaultModelId, peerAlias.id);
  assert.equal(preferences(peer.id).defaultReasoningPresetId, "member-template");
  assert.equal(read(connection => connection.prepare("SELECT model_id FROM conversations WHERE user_id=?").get(peer.id).model_id), peerAlias.id);
  assert.equal(config().models.find(model => model.id === "member-alias").ownerId, member.id);
  await restore(cookie, "beta18user", memberImage, "merge", "user", peer.id);
  assert.equal(config().models.filter(model => model.ownerId === peer.id).length, 1, "repeated restores are idempotent");
  assert.equal((await json("/api/config", "GET", undefined, peerCookie)).preferences.defaultModelId, peerAlias.id);

  // Images from other versions: none (beta 16/17), future fields and unknown models, unreadable.
  const legacy = await editImage(memberImage, "beta18user", value => { delete value.modelSettings; });
  const legacyResult = await restore(memberCookie, "beta18user", legacy, "merge");
  assert.equal(legacyResult.restored, true); assert.equal(legacyResult.modelSettings.status, "absent");
  const future = await editImage(adminImage, "beta18qa", value => {
    value.modelSettings.settings.version = 99; value.modelSettings.settings.futureField = { enabled: true };
    value.modelSettings.settings.models.push({ id: "not-served-here", sourceModel: "missing/model", name: "Missing", isAlias: false }, { name: "no id" });
    value.modelSettings.settings.models[0].unknownSetting = 5;
    value.modelSettings.somethingNew = [];
  });
  const futureResult = await restore(cookie, "beta18qa", future, "merge");
  assert.equal(futureResult.modelSettings.status, "restored");
  assert.equal(futureResult.modelSettings.skipped, 2);
  assert.equal(config().models.find(model => model.id === "qa-model").name, "QA model saved");
  assert.equal(config().models.some(model => model.id === "not-served-here"), false);
  const unreadable = await editImage(memberImage, "beta18user", value => { value.modelSettings = { settings: "garbage" }; });
  const unreadableResult = await restore(memberCookie, "beta18user", unreadable, "merge");
  assert.equal(unreadableResult.restored, true); assert.equal(unreadableResult.modelSettings.status, "invalid");
  // A default that no longer exists falls back to the workspace default.
  const orphan = await editImage(memberImage, "beta18user", value => { value.profile.preferences = JSON.stringify({ ...JSON.parse(value.profile.preferences), defaultModelId: "deleted-model" }); });
  await restore(memberCookie, "beta18user", orphan, "merge");
  assert.equal("defaultModelId" in preferences(member.id), false);
  await restore(memberCookie, "beta18user", memberImage, "merge");

  // ---- Browser QA: red delete prompts and the restore summary ------------------------------------
  const chrome = [process.env.BETA18_BROWSER_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find(candidate => candidate && existsSync(candidate));
  assert.ok(chrome, "Chrome or Edge is required for Beta 18 UI QA.");
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  const context = await browser.newContext({ viewport: { width: 1180, height: 900 }, extraHTTPHeaders: { cookie: memberCookie } });
  const page = await context.newPage(); const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) errors.push(message.text()); });
  await page.goto(`${root}/chat/beta18-chat`, { waitUntil: "domcontentloaded" });
  await page.locator(".user-message").first().waitFor();
  const dangerTone = async (open, file) => {
    await open();
    const layer = page.locator(".message-dialog-layer"); await layer.waitFor();
    assert.match(await layer.getAttribute("class"), /tone-danger/);
    const confirm = layer.locator(".message-dialog-confirm").last();
    const colors = await confirm.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, mark: getComputedStyle(element.closest(".message-dialog-layer").querySelector(".message-dialog-mark")).color }));
    assert.equal(colors.mark, "rgb(210, 123, 120)", "the prompt uses the danger colour");
    assert.equal(colors.background, "rgb(210, 123, 120)", "the confirming action is red");
    if (shots) await page.screenshot({ path: path.join(shots, file) });
    await page.keyboard.press("Escape"); await layer.waitFor({ state: "detached" });
    return colors;
  };
  await dangerTone(async () => { await page.locator(".history-row").first().hover(); await page.locator(".history-delete").first().click(); }, "delete-chat.png");
  await dangerTone(async () => { await page.locator(".user-message").first().hover(); await page.locator(".user-message-toolbar .delete").first().click(); }, "delete-message.png");
  assert.equal((await json("/api/conversations/beta18-chat", "GET", undefined, memberCookie)).id, "beta18-chat", "cancelled prompts delete nothing");

  await page.locator(".profile-settings-button").click();
  await page.locator(".settings-panel").waitFor();
  await page.locator(".settings-body nav button", { hasText: "계정" }).click();
  const card = page.locator(".backup-card").first();
  assert.match(await page.locator(".backup-settings .section-title, .backup-settings").first().textContent(), /모델 설정/);
  const imageFile = path.join(data, "member.nnbak"); writeFileSync(imageFile, memberImage);
  await card.locator("input[type=file]").setInputFiles(imageFile);
  const dialog = page.locator(".backup-credentials-dialog"); await dialog.waitFor();
  await dialog.locator("input").nth(0).fill("beta18user"); await dialog.locator("input").nth(1).fill(password);
  const restored = page.waitForResponse(response => response.url().endsWith("/api/backup") && response.request().method() === "POST");
  await dialog.locator(".save-button").click();
  assert.ok((await restored).ok);
  const notice = page.locator(".backup-settings .settings-notice");
  await notice.waitFor();
  assert.match(await notice.textContent(), /모델 설정: 커스텀 모델 1개, 추론 템플릿 0개를 복원했습니다\./);
  if (shots) await page.screenshot({ path: path.join(shots, "restore-notice.png") });
  assert.deepEqual(errors, []);
  console.log("Beta 18 integration passed.");
} finally {
  await browser?.close().catch(() => {});
  server.kill(); await once(server, "exit").catch(() => {});
  await new Promise(resolve => inference.close(resolve));
  await rm(data, { recursive: true, force: true }).catch(() => {});
}
