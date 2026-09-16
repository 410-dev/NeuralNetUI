import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const data = await mkdtemp(path.join(os.tmpdir(), "neural-beta14-"));

const reserve = http.createServer(); reserve.listen(0, "127.0.0.1"); await once(reserve, "listening");
const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
const root = `http://127.0.0.1:${port}`;
const appDir = process.env.BETA14_APP_DIR ? path.resolve(process.env.BETA14_APP_DIR) : process.cwd();
const staged = Boolean(process.env.BETA14_APP_DIR);
const runtime = process.env.BETA14_NODE || process.execPath;
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

// WCAG relative luminance, so the contrast claims in this release are measured rather than asserted.
const channel = value => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]) => 0.2126 * channel(r / 255) + 0.7152 * channel(g / 255) + 0.0722 * channel(b / 255);
const parse = value => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
const contrast = (front, back) => {
  const a = luminance(parse(front)), b = luminance(parse(back));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

try {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try { if ((await fetch(`${root}/api/auth/status`)).ok) break; } catch {}
    if (attempt === 149) throw new Error(`Server did not start.\n${logs}`);
    await delay(100);
  }
  const setup = await api("/api/auth/setup", "POST", { username: "beta14qa", displayName: "Beta 14 QA", password: "Beta14-Local-QA-2026" });
  assert.equal(setup.status, 201); cookie = setup.headers.get("set-cookie").split(";")[0];
  const config = await json("/api/config");
  const model = {
    id: "beta14-model", sourceModel: "beta14-model",
    // A deliberately long name: the title has to give way to the surface actions beside it.
    name: "Beta 14 QA model with a deliberately long display name", connectionId: "qa", isAlias: false, visible: true,
    reasoningSupported: false, systemPrompt: "저장된 시스템 프롬프트입니다.", contextWindowTokens: 8192, reasoningPresets: [],
  };
  config.connections = [{ id: "qa", name: "QA", driver: "openai", baseUrl: "http://127.0.0.1:9/v1", apiKey: "", models: [model] }];
  config.models = [model]; config.preferences.language = "ko"; config.harnessSettings.titleEnabled = false;
  await json("/api/config", "PUT", config);

  const stamp = new Date().toISOString();
  const conversationId = "beta14-chat";
  await json("/api/conversations", "POST", {
    id: conversationId, title: "Beta 14 채팅", modelId: model.id, activeBranchId: "main", createdAt: stamp, updatedAt: stamp,
    branches: [{
      id: "main", name: "Main", createdAt: stamp, updatedAt: stamp,
      messages: [
        { id: "u1", role: "user", content: "질문입니다.", createdAt: stamp },
        { id: "a1", role: "assistant", content: "응답입니다.", createdAt: stamp },
      ],
    }],
  });

  const chrome = [process.env.BETA14_BROWSER_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find(candidate => candidate && existsSync(candidate));
  assert.ok(chrome, "Chrome or Edge is required for Beta 14 browser QA.");
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  const context = await browser.newContext({ viewport: { width: 1180, height: 900 }, extraHTTPHeaders: { cookie } });
  const page = await context.newPage(); const browserErrors = []; const nativeDialogs = [];
  page.on("pageerror", error => browserErrors.push(error.stack || error.message));
  page.on("console", message => { if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) browserErrors.push(message.text()); });
  page.on("dialog", dialog => { nativeDialogs.push(dialog.message()); void dialog.dismiss(); });
  await page.goto(`${root}/chat/${conversationId}`, { waitUntil: "domcontentloaded" });
  await page.locator(".user-message").first().waitFor();

  // ---- 1. Every corner comes from the ladder. ----
  const cssText = await page.evaluate(async () => {
    const link = [...document.querySelectorAll("link[rel=stylesheet]")].map(node => node.href);
    const bodies = await Promise.all(link.map(href => fetch(href).then(response => response.text()).catch(() => "")));
    return bodies.join("\n");
  });
  assert.ok(cssText.includes("--radius-pill"), "The served stylesheet must be the application's own.");
  const appCss = cssText.slice(cssText.indexOf(":root"));
  const literalCorners = appCss.match(/border-radius:\s*\d+px/g) || [];
  assert.equal(literalCorners.length, 0, `Every corner must come from a token; found ${literalCorners.slice(0, 6).join(", ")}`);

  // ---- 2. Secondary type clears 4.5:1 wherever it is actually painted. ----
  const dim = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--dim").trim());
  assert.equal(dim, "#8b8e95", "Secondary type must be the raised value.");
  const surfaces = ["#0a0a0c", "#16161a", "#17171b", "#1a1a1f", "#1c1c21", "#1e1e23", "#232329", "#26262d"];
  for (const surface of surfaces) {
    const ratio = contrast(`rgb(139,142,149)`, `rgb(${parseInt(surface.slice(1, 3), 16)},${parseInt(surface.slice(3, 5), 16)},${parseInt(surface.slice(5, 7), 16)})`);
    assert.ok(ratio >= 4.5, `--dim on ${surface} is ${ratio.toFixed(2)}:1, below 4.5:1.`);
  }

  // ---- 3. The document announces the language the person chose. ----
  assert.equal(await page.evaluate(() => document.documentElement.lang), "ko");
  await json("/api/config", "PUT", { ...(await json("/api/config")), preferences: { ...(await json("/api/config")).preferences, language: "en" } });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".user-message").first().waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.lang), "en", "The document language must follow the chosen language.");
  await json("/api/config", "PUT", { ...(await json("/api/config")), preferences: { ...(await json("/api/config")).preferences, language: "ko" } });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".user-message").first().waitFor();

  // ---- 4. An icon-only action answers with colour and weight, never a plate. ----
  const action = page.locator(".message-action-button").first();
  await action.waitFor();
  await action.hover();
  // The answer is a spring, so settle on its final value rather than a frame inside it.
  const readAction = () => action.evaluate(element => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, transform: style.transform, color: style.color };
  });
  let hovered = await readAction();
  for (let attempt = 0; attempt < 40 && (hovered.transform === "none" || hovered.color !== "rgb(255, 255, 255)"); attempt += 1) {
    await delay(50); hovered = await readAction();
  }
  assert.match(hovered.background, /rgba\(0, 0, 0, 0\)|transparent/, "An icon-only action must not grow a plate on hover.");
  assert.notEqual(hovered.transform, "none", "An icon-only action answers the pointer with a little weight.");
  assert.equal(hovered.color, "rgb(255, 255, 255)", "An icon-only action brightens on hover.");

  // ---- 5. The model name gives way instead of sliding under the actions beside it. ----
  const title = await page.locator(".model-trigger > span").first().evaluate(element => {
    const style = getComputedStyle(element);
    return { overflow: style.overflow, ellipsis: style.textOverflow };
  });
  assert.equal(title.overflow, "hidden");
  assert.equal(title.ellipsis, "ellipsis");
  const clear = async label => {
    const titleBox = await page.locator(".model-trigger").boundingBox();
    const actionsBox = await page.locator(".surface-actions").boundingBox();
    assert.ok(titleBox.x + titleBox.width <= actionsBox.x + 1, `${label}: the model name must end before the surface actions begin.`);
  };
  await clear("desktop");
  // A phone is where the two actually met: the title used to run straight under the actions.
  await page.setViewportSize({ width: 420, height: 820 });
  await delay(250);
  await clear("phone");
  assert.ok(
    await page.locator(".model-trigger > span").first().evaluate(element => element.scrollWidth > element.clientWidth),
    "At phone width the long model name must be truncated rather than pushing the row wider.",
  );
  await page.setViewportSize({ width: 1180, height: 900 });
  await delay(250);

  // ---- 6. Keyboard focus is visible on a control and on a field. ----
  const ring = await page.locator(".message-action-button").first().evaluate(element => {
    element.focus();
    const style = getComputedStyle(element);
    return { width: style.outlineWidth, style: style.outlineStyle };
  });
  assert.notEqual(ring.style, "none", "A focused control must show a ring.");
  assert.notEqual(ring.width, "0px");

  // ---- 7. A search dialog opens with the keyboard in its field, not on Close. ----
  await page.locator(".pill-button", { hasText: "검색" }).first().click();
  await page.locator(".harness-dialog input").first().waitFor();
  await delay(200);
  const focused = await page.evaluate(() => {
    const element = document.activeElement;
    return { tag: element?.tagName, autofocus: element?.hasAttribute("data-autofocus") };
  });
  assert.equal(focused.tag, "INPUT", "A search dialog must open with focus in its field.");
  assert.ok(focused.autofocus, "The focused field must be the one the dialog named.");
  const fieldRing = await page.evaluate(() => getComputedStyle(document.activeElement).boxShadow);
  assert.notEqual(fieldRing, "none", "A focused field must show the shared ring.");
  await page.keyboard.press("Escape");
  await page.locator(".harness-dialog").waitFor({ state: "detached" });

  // ---- 8. Nothing-here states speak with one voice. ----
  await page.locator(".pill-button", { hasText: "검색" }).first().click();
  await page.locator(".harness-dialog input").first().fill("존재하지않는검색어입니다");
  await page.locator(".harness-dialog p[role=status]").first().waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".harness-dialog").waitFor({ state: "detached" });

  // Optional: capture the surfaces this release changed, for a visual read alongside the asserts.
  // BETA14_SHOTS=<directory> node scripts/test-beta14-integration.mjs
  if (process.env.BETA14_SHOTS) {
    const shots = path.resolve(process.env.BETA14_SHOTS);
    await mkdir(shots, { recursive: true });
    await page.screenshot({ path: path.join(shots, "01-thread.png") });
    await page.locator(".pill-button", { hasText: "검색" }).first().click();
    await page.locator(".harness-dialog input").first().waitFor();
    await page.screenshot({ path: path.join(shots, "02-search-dialog.png") });
    await page.keyboard.press("Escape");
    await page.locator(".harness-dialog").waitFor({ state: "detached" });
    await page.locator(".profile-card").click();
    await page.getByRole("dialog").waitFor();
    await page.screenshot({ path: path.join(shots, "03-settings.png") });
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 420, height: 820 });
    await delay(400);
    await page.screenshot({ path: path.join(shots, "04-phone.png") });
    await page.setViewportSize({ width: 1180, height: 900 });
    await delay(300);
  }

  // ---- 9. No native dialog, and no page error, at any point. ----
  assert.deepEqual(nativeDialogs, [], `A native browser dialog was opened: ${nativeDialogs.join(" | ")}`);
  assert.deepEqual(browserErrors, [], `Browser errors: ${browserErrors.join(" | ")}`);

  const version = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8")).version;
  console.log(`Beta 14 integration passed (${version}).`);
} finally {
  await browser?.close().catch(() => {});
  server.kill();
  await once(server, "exit").catch(() => {});
  await rm(data, { recursive: true, force: true }).catch(() => {});
}
