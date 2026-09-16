import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const data = await mkdtemp(path.join(os.tmpdir(), "neural-beta13-"));
const longPrompt = Array.from({ length: 40 }, (_, index) => `프롬프트 ${index + 1}번째 줄입니다.`).join("\n");

const reserve = http.createServer(); reserve.listen(0, "127.0.0.1"); await once(reserve, "listening");
const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
const root = `http://127.0.0.1:${port}`;
const appDir = process.env.BETA13_APP_DIR ? path.resolve(process.env.BETA13_APP_DIR) : process.cwd();
const staged = Boolean(process.env.BETA13_APP_DIR);
const runtime = process.env.BETA13_NODE || process.execPath;
const server = spawn(runtime, staged ? ["server.js"] : ["scripts/start-server.mjs", "start"], {
  cwd: appDir,
  windowsHide: true,
  env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: String(port), NEURAL_CHAT_DATA_DIR: data, NEURAL_CHAT_DB_PATH: path.join(data, "qa.sqlite3") },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "", cookie = "", browser;
server.stdout.on("data", chunk => { logs = (logs + chunk).slice(-16000); });
server.stderr.on("data", chunk => { logs = (logs + chunk).slice(-16000); });

async function api(route, method = "GET", body) {
  return fetch(root + route, {
    method,
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
}
async function json(route, method = "GET", body) {
  const response = await api(route, method, body); const value = await response.json().catch(() => ({}));
  assert.ok(response.ok, `${method} ${route}: ${JSON.stringify(value)}`); return value;
}
const opacityOf = (page, selector) => page.locator(selector).first().evaluate(element => getComputedStyle(element).opacity);
// The reveal is a transition, so settle on the final value rather than a frame inside it.
const settledOpacity = async (page, selector, expected) => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const value = await opacityOf(page, selector);
    if (value === expected) return value;
    await delay(50);
  }
  return opacityOf(page, selector);
};

try {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try { if ((await fetch(`${root}/api/auth/status`)).ok) break; } catch {}
    if (attempt === 149) throw new Error(`Server did not start.\n${logs}`);
    await delay(100);
  }
  const setup = await api("/api/auth/setup", "POST", { username: "beta13qa", displayName: "Beta 13 QA", password: "Beta13-Local-QA-2026" });
  assert.equal(setup.status, 201); cookie = setup.headers.get("set-cookie").split(";")[0];
  const config = await json("/api/config");
  const model = {
    id: "beta13-model", sourceModel: "beta13-model", name: "Beta 13 model", connectionId: "qa", isAlias: false, visible: true,
    reasoningSupported: false, systemPrompt: "저장된 시스템 프롬프트입니다.", contextWindowTokens: 8192,
    reasoningPresets: [{ id: "beta13-template", name: "QA 템플릿", kind: "custom", effort: "", systemPrompt: "저장된 추가 프롬프트입니다.", systemPromptMode: "append" }],
  };
  config.connections = [{ id: "qa", name: "QA", driver: "openai", baseUrl: "http://127.0.0.1:9/v1", apiKey: "", models: [model] }];
  config.models = [model]; config.preferences.language = "ko"; config.experimental.hostComputerTool = true;
  config.harnessSettings.titleEnabled = false;
  await json("/api/config", "PUT", config);

  // One request holds two revisions across two branches; the other exists only once.
  const stamp = new Date().toISOString();
  const message = (id, role, revisionGroupId) => ({ id, role, content: `${role}:${id}`, createdAt: stamp, ...(revisionGroupId ? { revisionGroupId } : {}) });
  const conversationId = "beta13-chat";
  await json("/api/conversations", "POST", {
    id: conversationId, title: "Beta 13 채팅", modelId: model.id, activeBranchId: "main", createdAt: stamp, updatedAt: stamp,
    branches: [
      { id: "main", name: "Main", createdAt: stamp, updatedAt: stamp, messages: [message("u1", "user"), message("a1", "assistant"), message("u2", "user"), message("a2", "assistant")] },
      { id: "edited", name: "수정본", parentBranchId: "main", forkedFromMessageId: "u2", createdAt: stamp, updatedAt: stamp, messages: [message("u1", "user"), message("a1", "assistant"), message("u2edit", "user", "u2"), message("a3", "assistant")] },
    ],
  });

  if (process.env.BETA13_QA_KEEP === "1") {
    console.log(`QA_READY ${root}/chat/${conversationId} beta13qa Beta13-Local-QA-2026`);
    await new Promise(resolve => { process.once("SIGINT", resolve); process.once("SIGTERM", resolve); });
    console.log("QA_STOPPED");
  } else {
  const chrome = [process.env.BETA13_BROWSER_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find(candidate => candidate && existsSync(candidate));
  assert.ok(chrome, "Chrome or Edge is required for Beta 13 browser QA.");
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  const context = await browser.newContext({ viewport: { width: 1180, height: 900 }, extraHTTPHeaders: { cookie }, acceptDownloads: true });
  const page = await context.newPage(); const browserErrors = []; const nativeDialogs = [];
  page.on("pageerror", error => browserErrors.push(error.stack || error.message));
  // Opening a chat probes for a live job, and no job is a legitimate 404 the page already ignores.
  const missing = [];
  page.on("console", message => { if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) browserErrors.push(message.text()); });
  page.on("dialog", dialog => { nativeDialogs.push(dialog.message()); void dialog.dismiss(); });
  page.on("response", response => { if (response.status() >= 400) missing.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  await page.goto(`${root}/chat/${conversationId}`, { waitUntil: "domcontentloaded" });
  await page.locator(".user-message").first().waitFor();

  // 3. Sent-message actions stay hidden until the pointer approaches that row.
  assert.equal(await opacityOf(page, ".user-message .user-message-toolbar"), "0");
  const rowBox = await page.locator(".user-message").first().boundingBox();
  const threadBox = await page.locator(".thread").boundingBox();
  // The far left of the row is empty space beside the bubble; the actions still have to appear.
  await page.mouse.move(rowBox.x + 6, rowBox.y + rowBox.height / 2);
  assert.equal(await settledOpacity(page, ".user-message .user-message-toolbar", "1"), "1", "The row itself, not only the bubble, must reveal the actions.");
  const band = await page.locator(".user-message").first().evaluate(element => {
    const style = getComputedStyle(element);
    return { paddingTop: parseFloat(style.paddingTop), paddingBottom: parseFloat(style.paddingBottom), marginTop: parseFloat(style.marginTop), marginBottom: parseFloat(style.marginBottom) };
  });
  assert.ok(band.paddingTop >= 8 && band.paddingBottom >= 8, JSON.stringify(band));
  assert.ok(Math.abs(band.paddingTop + band.marginTop) < 1 && Math.abs(band.paddingBottom + band.marginBottom - 30) < 1, JSON.stringify(band));
  await page.mouse.move(threadBox.x + 4, threadBox.y + 4);
  assert.equal(await settledOpacity(page, ".user-message .user-message-toolbar", "0"), "0");

  // 1. Editing a sent message and an answer both open the shared editor dialog.
  for (const [label, expected] of [["편집 후 분기", "분기 후 전송"], ["응답 편집", "저장"]]) {
    await page.locator(".user-message").first().hover();
    await page.getByRole("button", { name: label }).first().click();
    const dialog = page.locator(".harness-dialog.text-dialog"); await dialog.waitFor();
    const editor = await dialog.locator("textarea").evaluate(element => ({ height: element.clientHeight, width: element.clientWidth }));
    assert.ok(editor.height >= 200 && editor.width >= 400, `${label}: ${JSON.stringify(editor)}`);
    await assert.doesNotReject(dialog.getByRole("button", { name: expected }).first().waitFor());
    await dialog.getByRole("button", { name: "취소" }).first().click();
    await dialog.waitFor({ state: "detached" });
  }
  assert.equal(await page.locator(".message-edit, .assistant-edit").count(), 0, "The cramped inline editors must be gone.");

  // 6/5/4. Attachment section, dividers and fold spacing in the tool menu.
  await page.getByRole("button", { name: "추가" }).click();
  const menu = page.locator(".add-menu-popover"); await menu.waitFor();
  const layout = await menu.evaluate(element => {
    const children = [...element.children];
    const heading = element.querySelector(":scope > p");
    const groups = [...element.querySelectorAll(":scope > .composer-tool-group")];
    const firstGroup = groups[0];
    const rows = [...firstGroup.querySelectorAll(".tool-toggle-row")];
    return {
      order: children.map(child => child.tagName === "SECTION" ? `section:${child.querySelector("button span")?.textContent}` : `${child.tagName}:${(child.textContent || "").trim().slice(0, 12)}`),
      headingBorder: getComputedStyle(heading).borderTopWidth,
      groupBorders: groups.map(group => getComputedStyle(group).borderTopWidth),
      foldGap: groups[1].getBoundingClientRect().top - rows.at(-1).getBoundingClientRect().bottom,
      storageRowIndex: children.findIndex(child => child.classList.contains("tool-toggle-row")),
      headingIndex: children.indexOf(heading),
      uploadLabel: children[0].textContent.trim(),
      storageLabel: children.find(child => child.classList.contains("tool-toggle-row"))?.textContent.trim(),
    };
  });
  assert.ok(layout.uploadLabel.includes("업로드") && !layout.uploadLabel.includes("첨부"), JSON.stringify(layout));
  assert.ok(layout.storageLabel.startsWith("저장소 접근"), JSON.stringify(layout));
  assert.ok(layout.storageRowIndex === 2 && layout.headingIndex === 3, `Storage access belongs to the attachment section: ${JSON.stringify(layout)}`);
  assert.notEqual(layout.headingBorder, "0px", "The rule above the tool list is kept.");
  assert.deepEqual([...new Set(layout.groupBorders)], ["0px"], "Tool groups no longer carry a rule between them.");
  assert.ok(layout.foldGap >= 6, `An open fold must not touch the next fold: ${JSON.stringify(layout)}`);
  await page.keyboard.press("Escape");
  await page.mouse.click(threadBox.x + 4, threadBox.y + 4);

  // 3 (continued) + 2 + the new branch-scoped deletion.
  await page.locator(".user-message").nth(1).hover();
  await page.locator(".user-message").nth(1).getByRole("button", { name: "메시지 삭제" }).click();
  const scopeDialog = page.locator(".message-dialog-layer"); await scopeDialog.waitFor();
  assert.ok(await scopeDialog.evaluate(element => element.classList.contains("tone-warning")));
  for (const label of ["이 분기만", "모든 분기", "취소"]) await assert.doesNotReject(scopeDialog.getByRole("button", { name: label }).waitFor());
  await scopeDialog.getByRole("button", { name: "모든 분기" }).click();
  await scopeDialog.waitFor({ state: "detached" });
  await page.waitForFunction(() => document.querySelectorAll(".user-message").length === 1);
  const afterScoped = await json(`/api/conversations/${conversationId}`);
  assert.equal(afterScoped.branches.length, 1, JSON.stringify(afterScoped.branches.map(branch => branch.messages.map(item => item.id))));
  assert.deepEqual(afterScoped.branches[0].messages.map(item => item.id), ["u1", "a1"]);

  // A request that exists once keeps the plain confirmation, in the same in-app message box.
  await page.locator(".user-message").first().hover();
  await page.locator(".user-message").first().getByRole("button", { name: "메시지 삭제" }).click();
  const confirmDialog = page.locator(".message-dialog-layer"); await confirmDialog.waitFor();
  assert.equal(await confirmDialog.getByRole("button", { name: "이 분기만" }).count(), 0);
  const warningColor = await confirmDialog.locator(".message-dialog-confirm").evaluate(element => getComputedStyle(element).backgroundColor);
  await confirmDialog.getByRole("button", { name: "취소" }).click();
  await confirmDialog.waitFor({ state: "detached" });

  // 2 (tones differ by kind) — a permanent deletion is styled apart from a recoverable one.
  await page.getByRole("button", { name: "전체 대화 삭제" }).click();
  const dangerDialog = page.locator(".message-dialog-layer.tone-danger"); await dangerDialog.waitFor();
  const dangerColor = await dangerDialog.locator(".message-dialog-confirm").evaluate(element => getComputedStyle(element).backgroundColor);
  assert.notEqual(dangerColor, warningColor, "Each kind of message needs its own styling.");
  await dangerDialog.getByRole("button", { name: "취소" }).click();
  await dangerDialog.waitFor({ state: "detached" });

  // 7. Renaming offers the duplicate, which stays disabled until the title actually changes.
  await page.locator(".history-row").first().hover();
  await page.getByRole("button", { name: "제목 변경: Beta 13 채팅" }).click();
  const renameDialog = page.locator(".harness-dialog.text-dialog"); await renameDialog.waitFor();
  const duplicate = renameDialog.getByRole("button", { name: "복제하기" });
  assert.equal(await duplicate.isDisabled(), true, "Duplicating without a new title would produce two identical rows.");
  await renameDialog.locator("input").fill("Beta 13 채팅 사본");
  assert.equal(await duplicate.isDisabled(), false);
  await duplicate.click();
  await renameDialog.waitFor({ state: "detached" });
  const duplicated = page.locator(".message-dialog-layer.tone-success"); await duplicated.waitFor();
  await duplicated.getByRole("button", { name: "닫기" }).click();
  await duplicated.waitFor({ state: "detached" });
  await page.waitForFunction(() => document.querySelectorAll(".history-row").length === 2);
  const listed = await json("/api/conversations");
  const copySummary = listed.conversations.find(item => item.title === "Beta 13 채팅 사본");
  assert.ok(copySummary && copySummary.id !== conversationId, JSON.stringify(listed.conversations));
  const copy = await json(`/api/conversations/${copySummary.id}`);
  const original = await json(`/api/conversations/${conversationId}`);
  assert.equal(copy.branches.length, original.branches.length);
  assert.deepEqual(copy.branches.map(branch => branch.messages.length), original.branches.map(branch => branch.messages.length));
  const sharedIds = copy.branches.flatMap(branch => [branch.id, ...branch.messages.map(item => item.id)])
    .filter(id => original.branches.some(branch => branch.id === id || branch.messages.some(item => item.id === id)));
  assert.deepEqual(sharedIds, [], "A copy that reused identifiers would collide with the original.");

  // 8. With no chat open the download button packages every chat as one archive.
  await page.getByRole("button", { name: "새 채팅" }).click();
  await page.waitForFunction(() => !document.querySelector(".message-row"));
  await page.getByRole("button", { name: "전체 채팅 내보내기" }).first().click();
  const exportDialog = page.locator(".export-dialog"); await exportDialog.waitFor();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    exportDialog.getByRole("button", { name: "ZIP · 전체 채팅" }).click(),
  ]);
  assert.match(download.suggestedFilename(), /^neuralnetui-chats-\d{4}-\d{2}-\d{2}\.zip$/);
  const archivePath = path.join(data, "export.zip"); await download.saveAs(archivePath);
  const archive = await readFile(archivePath);
  assert.equal(archive.subarray(0, 4).toString("hex"), "504b0304");
  const names = archive.toString("latin1");
  assert.ok(names.includes("chats.json"), "The archive names its contents.");
  assert.equal([...names.matchAll(/chats\//g)].length >= 2, true, "Every chat keeps its own file in the archive.");

  // 1 (continued). Both saved prompts are read-only in place and edited in the dialog.
  await page.getByRole("button", { name: "설정" }).first().click();
  for (const [tab, label, saved, typed] of [["모델", "시스템 프롬프트", "저장된 시스템 프롬프트입니다.", longPrompt], ["추론 수준", "추가 시스템 프롬프트", "저장된 추가 프롬프트입니다.", "편집한 추가 프롬프트입니다."]]) {
    await page.locator(".settings-body nav button", { hasText: tab }).first().click();
    const field = page.locator(".locked-field", { has: page.getByRole("textbox", { name: label }) }).first();
    await field.waitFor();
    const locked = await field.locator("textarea").evaluate(element => ({ readOnly: element.readOnly, value: element.value }));
    assert.equal(locked.readOnly, true, `${label} must be locked in place rather than removed.`);
    assert.equal(locked.value, saved);
    await field.getByRole("button", { name: "프롬프트 편집" }).click();
    const promptDialog = page.locator(".harness-dialog.text-dialog"); await promptDialog.waitFor();
    await promptDialog.locator("textarea").fill(typed);
    await promptDialog.getByRole("button", { name: "저장" }).click();
    await promptDialog.waitFor({ state: "detached" });
    assert.equal(await field.locator("textarea").inputValue(), typed);
  }
  await page.getByRole("button", { name: "변경사항 저장" }).click();
  await page.waitForFunction(() => document.querySelector(".settings-panel footer span")?.textContent?.includes("저장했습니다"));
  const savedConfig = await json("/api/config");
  assert.equal(savedConfig.models[0].systemPrompt, longPrompt);
  assert.equal(savedConfig.models[0].reasoningPresets[0].systemPrompt, "편집한 추가 프롬프트입니다.");

  assert.deepEqual(nativeDialogs, [], "Native browser dialogs must no longer be used.");
  assert.deepEqual([...new Set(missing)].filter(entry => !entry.startsWith("404 /api/chat/")), [], "Only the live-job probe may answer with an error.");
  assert.deepEqual(browserErrors, []);
  await context.close();
  }
  console.log("PASS Beta 13: modal long-text editing, in-app message boxes, hover-revealed request actions, attachment-section storage access, tidy tool folds, chat duplication, whole-history archive, and branch-scoped deletion");
} catch (error) {
  console.error(logs); throw error;
} finally {
  if (browser) await browser.close();
  server.kill();
  if (server.exitCode === null) await Promise.race([once(server, "exit"), delay(5_000)]);
  await rm(data, { recursive: true, force: true });
}
