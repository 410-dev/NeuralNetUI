import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
import sharp from "sharp";

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const reserve = http.createServer();
reserve.listen(0, "127.0.0.1");
await once(reserve, "listening");
const port = reserve.address().port;
await new Promise(resolve => reserve.close(resolve));
const root = `http://127.0.0.1:${port}`;
const data = await mkdtemp(path.join(os.tmpdir(), "neural-beta11-"));
const appDir = process.env.BETA11_APP_DIR ? path.resolve(process.env.BETA11_APP_DIR) : process.cwd();
const staged = Boolean(process.env.BETA11_APP_DIR);
const runtime = process.env.BETA11_NODE || process.execPath;
const child = spawn(runtime, staged ? ["server.js"] : ["scripts/start-server.mjs", "start"], {
  cwd: appDir,
  windowsHide: true,
  env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: String(port), NEURAL_CHAT_DATA_DIR: data, NEURAL_CHAT_DB_PATH: path.join(data, "qa.sqlite3") },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "", cookie = "", browser;
child.stdout.on("data", chunk => { logs = (logs + chunk).slice(-12000); });
child.stderr.on("data", chunk => { logs = (logs + chunk).slice(-12000); });

async function api(route, method = "GET", body) {
  const response = await fetch(root + route, {
    method,
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  const value = await response.json().catch(() => ({}));
  assert.ok(response.ok, `${method} ${route}: ${JSON.stringify(value)}`);
  return value;
}

const conversation = (id, title, attachment, updatedAt) => ({
  id,
  title,
  modelId: "qa-model",
  activeBranchId: `branch-${id}`,
  createdAt: updatedAt,
  updatedAt,
  branches: [{ id: `branch-${id}`, name: "Main", createdAt: updatedAt, updatedAt, messages: [{ id: `message-${id}`, role: "user", content: `body ${title}`, ...(attachment ? { attachments: [attachment] } : {}), createdAt: updatedAt }] }],
});

try {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try { if ((await fetch(`${root}/api/auth/status`)).ok) break; } catch {}
    if (attempt === 149) throw new Error(`Server did not start.\n${logs}`);
    await delay(100);
  }
  const setup = await fetch(`${root}/api/auth/setup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "beta11qa", displayName: "Beta 11 QA", password: "Beta11-Local-QA-2026" }) });
  assert.equal(setup.status, 201);
  cookie = setup.headers.get("set-cookie").split(";")[0];

  const config = await api("/api/config");
  const model = { id: "qa-model", sourceModel: "qa-model", name: "QA model", connectionId: "qa", isAlias: false, visible: true, reasoningSupported: false, reasoningPresets: [], contextWindowTokens: 4096, visionImageMode: "max-resolution", visionMaxEdgePixels: 1024 };
  config.connections = [{ id: "qa", name: "QA", driver: "openai", baseUrl: "http://127.0.0.1:1/v1", apiKey: "", clearApiKey: true, models: [model] }];
  config.models = [model];
  config.preferences.language = "en";
  await api("/api/config", "PUT", config);

  for (let index = 1; index <= 12; index += 1) {
    const stamp = new Date(Date.now() - index * 60000).toISOString();
    await api("/api/conversations", "POST", conversation(`managed-${index}`, `Managed chat ${String(index).padStart(2, "0")}`, undefined, stamp));
  }
  await api("/api/storage/files", "POST", { name: "beta11-card.txt", kind: "text", content: "fixture" });
  const image = await sharp({ create: { width: 32, height: 32, channels: 4, background: { r: 30, g: 80, b: 140, alpha: 1 } } }).png().toBuffer();
  const form = new FormData();
  form.append("retained", "true");
  form.append("files", new File([image], "beta11-reference.png", { type: "image/png" }));
  form.append("thumbnail-0", new File([image], "thumbnail.png", { type: "image/png" }));
  form.append("dimensions-0", JSON.stringify({ width: 32, height: 32 }));
  const uploadResponse = await fetch(`${root}/api/uploads`, { method: "POST", headers: { cookie }, body: form });
  const uploadBody = await uploadResponse.json();
  assert.ok(uploadResponse.ok, JSON.stringify(uploadBody));
  const referencedFile = uploadBody.attachments[0];
  const referencedStamp = new Date().toISOString();
  await api("/api/conversations", "POST", conversation("referenced-chat", "Referenced chat", referencedFile, referencedStamp));
  const seededStorage = await api("/api/storage?page=1&pageSize=10&sort=created_desc&q=");
  assert.equal(seededStorage.files.length, 2);

  const chrome = [process.env.BETA11_BROWSER_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find(candidate => candidate && existsSync(candidate));
  assert.ok(chrome, "Chrome or Edge is required for Beta 11 browser QA.");
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 850 }, extraHTTPHeaders: { cookie } });
  const page = await context.newPage();
  const browserErrors = [], storageResponses = [];
  page.on("pageerror", error => browserErrors.push(error.stack || error.message));
  page.on("console", message => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("response", async response => { if (/\/api\/storage\?/.test(response.url())) storageResponses.push(`${response.status()} ${await response.text().catch(() => "<unreadable>")}`); });
  page.on("dialog", dialog => dialog.dismiss());
  await page.goto(root, { waitUntil: "networkidle" });

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Models", exact: true }).click();
  const resolutionInput = page.locator(".model-image-input-row input");
  const resolutionStyle = await resolutionInput.evaluate(element => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, borderStyle: style.borderStyle, radius: parseFloat(style.borderTopLeftRadius), height: element.getBoundingClientRect().height };
  });
  assert.notEqual(resolutionStyle.background, "rgb(255, 255, 255)");
  assert.equal(resolutionStyle.borderStyle, "solid");
  assert.ok(resolutionStyle.radius >= resolutionStyle.height / 2);
  await page.locator(".settings-panel > header button").click();

  const urlBeforeStorage = page.url();
  await page.getByRole("button", { name: "Storage manager" }).click();
  assert.equal(page.url(), urlBeforeStorage, `Storage manager navigation changed the page to ${page.url()}`);
  await page.getByRole("dialog", { name: "Storage manager" }).waitFor();
  const card = page.locator(".storage-file-grid article").first();
  await delay(1000);
  assert.equal(child.exitCode, null, `QA server exited early.\n${logs}`);
  assert.equal(await card.count(), 1, `${await page.locator("body").innerText()}\n${browserErrors.join("\n")}\n${storageResponses.join("\n")}`);
  const cardMetrics = await card.evaluate(element => {
    const preview = element.querySelector(".storage-file-preview").getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    return { radius: parseFloat(getComputedStyle(element).borderTopLeftRadius), top: preview.top - rect.top, bottom: rect.bottom - preview.bottom };
  });
  assert.ok(cardMetrics.radius >= 22);
  assert.ok(Math.abs(cardMetrics.top - cardMetrics.bottom) <= 1, JSON.stringify(cardMetrics));
  const referencedRow = page.locator(".storage-file-grid article").filter({ hasText: "beta11-reference.png" });
  await referencedRow.locator(".storage-delete-file").click();
  const references = page.getByRole("dialog", { name: "Chats using this file" });
  await references.waitFor();
  assert.equal(await page.locator(".file-reference-open > svg").count(), 0);
  const referencePill = await page.locator(".file-reference-list article").first().evaluate(element => ({ radius: parseFloat(getComputedStyle(element).borderTopLeftRadius), height: element.getBoundingClientRect().height }));
  assert.ok(referencePill.radius >= referencePill.height / 2);
  await page.locator(".file-references-dialog > header button").click();
  await page.locator(".storage-manager-dialog > header button").click();

  assert.equal(await page.locator(".chat-manager-launch svg").count(), 0);
  const history = page.locator(".history-list");
  await history.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await page.getByRole("button", { name: "Manage chats" }).click();
  const manager = page.getByRole("dialog", { name: "Manage chats" });
  await manager.waitFor();
  const managedRows = page.locator(".chat-manager-list article");
  await managedRows.first().waitFor();
  assert.equal(await managedRows.count(), 10);
  assert.equal(await page.locator(".chat-manager-open > svg").count(), 0);
  const managerPill = await managedRows.first().evaluate(element => ({ radius: parseFloat(getComputedStyle(element).borderTopLeftRadius), height: element.getBoundingClientRect().height }));
  assert.ok(managerPill.radius >= managerPill.height / 2);
  await page.getByRole("button", { name: "Select chats" }).click();
  const firstTitle = await managedRows.first().locator("strong").textContent();
  const beforeUrl = page.url();
  await managedRows.first().locator(".chat-manager-open").click();
  assert.equal(page.url(), beforeUrl);
  await manager.waitFor();
  assert.equal(await managedRows.first().locator(".circle-check").getAttribute("aria-pressed"), "true", `Clicking ${firstTitle} should select it without navigation.`);

  await context.close();
  console.log("PASS Beta 11: unified pill styling, 10-chat pages, non-navigating selection, and balanced storage cards");
  if (process.env.BETA11_QA_KEEP === "1") {
    console.log(`Beta 11 manual QA: ${root} | user=beta11qa | password=Beta11-Local-QA-2026`);
    await new Promise(() => {});
  }
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  if (browser) await browser.close();
  child.kill();
  if (child.exitCode === null) await Promise.race([once(child, "exit"), delay(5000)]);
  await rm(data, { recursive: true, force: true });
}
