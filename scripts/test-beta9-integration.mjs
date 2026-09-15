import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const reserve = http.createServer(); reserve.listen(0, "127.0.0.1"); await once(reserve, "listening");
const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
const root = `http://127.0.0.1:${port}`;
const data = await mkdtemp(path.join(os.tmpdir(), "neural-beta9-"));
const appDir = process.env.BETA9_APP_DIR ? path.resolve(process.env.BETA9_APP_DIR) : process.cwd();
const staged = Boolean(process.env.BETA9_APP_DIR); const runtime = process.env.BETA9_NODE || process.execPath;
const child = spawn(runtime, staged ? ["server.js"] : ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: appDir, windowsHide: true,
  env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: String(port), NEURAL_CHAT_DATA_DIR: data, NEURAL_CHAT_DB_PATH: path.join(data, "qa.sqlite3") },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = ""; child.stdout.on("data", chunk => { logs = (logs + chunk).slice(-12_000); }); child.stderr.on("data", chunk => { logs = (logs + chunk).slice(-12_000); });
let cookie = ""; let browser;

async function api(route, method = "GET", body) {
  const response = await fetch(root + route, { method, headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
  const value = await response.json().catch(() => ({})); assert.ok(response.ok, `${method} ${route}: ${JSON.stringify(value)}`); return { response, value };
}

try {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try { if ((await fetch(`${root}/api/auth/status`)).ok) break; } catch { /* server is starting */ }
    if (attempt === 149) throw new Error(`Server did not start.\n${logs}`); await delay(100);
  }
  const setup = await fetch(`${root}/api/auth/setup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "beta9qa", displayName: "Beta 9 QA", password: "Beta9-Local-QA-2026" }) });
  assert.equal(setup.status, 201); cookie = setup.headers.get("set-cookie").split(";")[0];
  for (let index = 1; index <= 7; index += 1) await api("/api/storage/files", "POST", { name: `beta9-file-${index}.txt`, kind: "text", content: `fixture ${index}` });
  const firstPage = (await api("/api/storage?page=1&pageSize=5&sort=name_asc")).value;
  assert.equal(firstPage.total, 7); assert.equal(firstPage.files.length, 5); assert.equal(firstPage.pageCount, 2);
  await api("/api/storage", "DELETE", { ids: firstPage.files.slice(0, 2).map(file => file.id), page: 1, pageSize: 5, sort: "name_asc" });
  const afterBulk = (await api("/api/storage?page=1&pageSize=5&sort=name_asc")).value;
  assert.equal(afterBulk.total, 5); assert.equal(afterBulk.files.length, 5);

  const chrome = [process.env.BETA9_BROWSER_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find(candidate => candidate && existsSync(candidate));
  assert.ok(chrome, "Chrome or Edge is required for Beta 9 browser QA."); browser = await chromium.launch({ executablePath: chrome, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 850 }, extraHTTPHeaders: { cookie } }); const page = await context.newPage();
  await page.goto(root, { waitUntil: "networkidle" }); await page.getByRole("button", { name: "Storage manager" }).click();
  const rows = page.locator(".storage-file-grid article"); await assert.doesNotReject(rows.nth(4).waitFor()); assert.equal(await rows.count(), 5);
  await rows.first().locator(".storage-delete-file").click(); await page.getByText("Deleted 1 file(s).").waitFor(); assert.equal(await rows.count(), 4);
  const preview = rows.first().locator(".storage-file-preview"); await preview.dispatchEvent("pointerdown"); await delay(650); await preview.dispatchEvent("pointerup");
  await page.locator(".storage-delete-toolbar").waitFor(); assert.match(await page.locator(".storage-delete-toolbar").innerText(), /1 selected/);
  await rows.nth(1).locator(".storage-file-preview").click(); assert.match(await page.locator(".storage-delete-toolbar").innerText(), /2 selected/);
  await page.getByRole("button", { name: "Delete selected" }).click(); await page.getByText("Deleted 2 file(s).").waitFor(); assert.equal(await rows.count(), 2);
  const users = (await api("/api/users?page=1")).value; const user = users.users.find(item => item.username === "beta9qa"); assert.ok(user);
  const trash = (await api(`/api/users/${user.id}/audit?view=files&state=deleted&page=1&pageSize=24`)).value; assert.equal(trash.total, 5);
  await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  await context.close(); console.log("PASS Beta 9: personal storage uses five-item pages and single/long-press bulk deletion moves files to trash");
} catch (error) { console.error(logs); throw error; }
finally { if (browser) await browser.close(); child.kill(); if (child.exitCode === null) await Promise.race([once(child, "exit"), delay(5_000)]); await rm(data, { recursive: true, force: true }); }
