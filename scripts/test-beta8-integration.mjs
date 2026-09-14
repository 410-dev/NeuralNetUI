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

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const keep = process.env.BETA8_QA_KEEP === "1";
let port = Number(process.env.BETA8_QA_PORT || 0);
if (!port) {
  const reserve = http.createServer(); reserve.listen(0, "127.0.0.1"); await once(reserve, "listening");
  port = reserve.address().port; await new Promise((resolve) => reserve.close(resolve));
}
const root = `http://127.0.0.1:${port}`;
const data = await mkdtemp(path.join(os.tmpdir(), "neural-beta8-"));
const appDir = process.env.BETA8_APP_DIR ? path.resolve(process.env.BETA8_APP_DIR) : process.cwd();
const staged = Boolean(process.env.BETA8_APP_DIR);
const runtime = process.env.BETA8_NODE || process.execPath;
const child = spawn(runtime, staged ? ["server.js"] : ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: appDir, windowsHide: true,
  env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: String(port), NEURAL_CHAT_DATA_DIR: data, NEURAL_CHAT_DB_PATH: path.join(data, "qa.sqlite3") },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = ""; child.stdout.on("data", (chunk) => { logs = (logs + chunk).slice(-12_000); }); child.stderr.on("data", (chunk) => { logs = (logs + chunk).slice(-12_000); });
let cookie = ""; let browser;

async function api(route, method = "GET", body) {
  const json = body !== undefined && !(body instanceof FormData);
  return fetch(root + route, {
    method,
    headers: { ...(json ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: json ? JSON.stringify(body) : body }),
    signal: AbortSignal.timeout(60_000),
  });
}
async function json(route, method, body) {
  const response = await api(route, method, body); const value = await response.json();
  assert.ok(response.ok, `${method || "GET"} ${route}: ${JSON.stringify(value)}`); return value;
}
const stamp = () => new Date().toISOString();
async function seed(id, assistant) {
  const createdAt = stamp(); const branchId = `${id}-main`;
  return json("/api/conversations", "POST", {
    id, title: id, modelId: "qa-model", activeBranchId: branchId, createdAt, updatedAt: createdAt,
    branches: [{ id: branchId, name: "Main", createdAt, updatedAt: createdAt, messages: [
      { id: `${id}-user`, role: "user", content: "QA request", createdAt }, assistant,
    ] }],
  });
}

async function verifyImageDoesNotReload(name, viewport, uploadId) {
  const context = await browser.newContext({ viewport, extraHTTPHeaders: { cookie } });
  const page = await context.newPage(); let requests = 0;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === `/api/uploads/${uploadId}` && !url.search) requests += 1;
  });
  await page.goto(`${root}/chat/beta8-image`, { waitUntil: "networkidle" });
  const image = page.locator(`img[src="/api/uploads/${uploadId}"]`);
  await image.waitFor();
  await image.evaluate((element) => new Promise((resolve, reject) => {
    const target = /** @type {HTMLImageElement} */ (element);
    if (target.complete && target.naturalWidth) return resolve();
    target.addEventListener("load", () => resolve(), { once: true });
    target.addEventListener("error", () => reject(new Error("Chat image failed to load")), { once: true });
  }));
  await image.evaluate((element) => { element.dataset.beta8Identity = "stable"; });
  for (let index = 0; index < 4; index += 1) {
    await page.locator(".thread").evaluate((element) => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event("scroll")); });
    await delay(100);
    await page.locator(".thread").evaluate((element) => { element.scrollTop = 0; element.dispatchEvent(new Event("scroll")); });
    await delay(100);
  }
  assert.equal(await image.getAttribute("data-beta8-identity"), "stable", `${name}: image DOM node was remounted while scrolling`);
  assert.equal(requests, 1, `${name}: expected one authenticated image request, received ${requests}`);
  await context.close();
}

try {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try { if ((await fetch(`${root}/api/auth/status`)).ok) break; } catch { /* server is starting */ }
    if (attempt === 149) throw new Error(`Server did not start.\n${logs}`);
    await delay(100);
  }
  const setup = await api("/api/auth/setup", "POST", { username: "beta8qa", displayName: "Beta 8 QA", password: "Beta8-Local-QA-2026" });
  assert.equal(setup.status, 201); cookie = setup.headers.get("set-cookie").split(";")[0];

  const editCreatedAt = stamp();
  await seed("beta8-edit", {
    id: "beta8-edit-assistant", role: "assistant", content: "old beforeold after", reasoning: "plan", createdAt: editCreatedAt,
    toolEvents: [{ id: "beta8-tool", name: "get_current_time", status: "completed", startedAt: editCreatedAt, result: { time: "12:00" } }],
    steps: [{ kind: "reasoning", text: "plan" }, { kind: "content", text: "old before" }, { kind: "tools", ids: ["beta8-tool"] }, { kind: "content", text: "old after" }],
  });

  const png = await sharp({ create: { width: 2800, height: 2800, channels: 3, background: { r: 44, g: 94, b: 132 } } }).png().toBuffer();
  const thumbnail = await sharp(png).resize({ width: 512, height: 512, fit: "inside" }).jpeg().toBuffer();
  const form = new FormData(); form.append("retained", "true"); form.append("files", new File([png], "large-beta8.png", { type: "image/png" }));
  form.append("thumbnail-0", new File([thumbnail], "large-beta8.thumbnail.jpg", { type: "image/jpeg" }));
  form.append("dimensions-0", JSON.stringify({ width: 2800, height: 2800 }));
  const uploadResponse = await api("/api/uploads", "POST", form); const uploadBody = await uploadResponse.json();
  assert.ok(uploadResponse.ok, JSON.stringify(uploadBody)); const uploadId = uploadBody.attachments[0].id;
  const paragraphs = Array.from({ length: 28 }, (_, index) => `Scroll fixture paragraph ${index + 1}. `.repeat(12)).join("\n\n");
  const imageContent = `${paragraphs}\n\n![Large Beta 8 fixture](/api/uploads/${uploadId})\n\n${paragraphs}`;
  await seed("beta8-image", { id: "beta8-image-assistant", role: "assistant", content: imageContent, steps: [{ kind: "content", text: imageContent }], createdAt: stamp() });

  const chrome = [
    process.env.BETA8_BROWSER_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].find((candidate) => candidate && existsSync(candidate));
  assert.ok(chrome, "Chrome or Edge is required for Beta 8 browser QA.");
  browser = await chromium.launch({ executablePath: chrome, headless: true });

  const editContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { cookie } });
  const editPage = await editContext.newPage(); await editPage.goto(`${root}/chat/beta8-edit`, { waitUntil: "networkidle" });
  await editPage.getByRole("button", { name: "Edit response" }).click();
  await editPage.locator(".assistant-edit textarea").fill("corrected persisted response");
  await editPage.locator(".assistant-edit .save-response").click();
  await editPage.getByText("corrected persisted response", { exact: true }).waitFor();
  assert.equal(await editPage.getByText("old beforeold after", { exact: true }).count(), 0);
  const persisted = await json("/api/conversations/beta8-edit");
  const active = persisted.branches.find((branch) => branch.id === persisted.activeBranchId);
  const edited = active.messages.at(-1);
  assert.equal(edited.content, "corrected persisted response");
  assert.deepEqual(edited.steps.filter((step) => step.kind === "content"), [{ kind: "content", text: "corrected persisted response" }]);
  await editContext.close();

  await verifyImageDoesNotReload("desktop", { width: 1440, height: 900 }, uploadId);
  await verifyImageDoesNotReload("mobile", { width: 390, height: 844 }, uploadId);
  console.log("PASS Beta 8: edited responses persist and large chat images stay mounted with one request on desktop and mobile");
  if (keep) {
    console.log(`QA_READY ${root} beta8qa Beta8-Local-QA-2026`);
    await new Promise((resolve) => { process.once("SIGINT", resolve); process.once("SIGTERM", resolve); });
  }
} catch (error) {
  console.error(logs); throw error;
} finally {
  if (browser) await browser.close();
  child.kill(); if (child.exitCode === null) await Promise.race([once(child, "exit"), delay(5_000)]);
  await rm(data, { recursive: true, force: true });
}
