import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const data = await mkdtemp(path.join(os.tmpdir(), "neural-beta12-"));
const sentinel = path.join(data, "cancelled-command-must-not-finish.txt");
const command = process.platform === "win32"
  ? `$qaMarker = '${sentinel.replace(/'/g, "''")}'; $qaLongValue = '${"x".repeat(900)}'; Start-Sleep -Seconds 20; Set-Content -LiteralPath $qaMarker -Value $qaLongValue`
  : `sleep 20; printf completed > '${sentinel.replace(/'/g, "'\\''")}'`;
const explanation = [
  "이 명령은 지정한 셸에서 장시간 작업을 실행합니다.",
  `완료되면 ${sentinel}${"매우긴경로".repeat(45)} 파일을 만듭니다.`,
  "중단 버튼을 누르면 실행 중인 프로세스 트리까지 종료되어야 합니다.",
  "첫 번째 추가 해설 줄입니다.",
  "두 번째 추가 해설 줄입니다.",
  "세 번째 추가 해설 줄입니다.",
  "네 번째 추가 해설 줄입니다.",
  "다섯 번째 추가 해설 줄입니다.",
].join("\n");
const longRequestContent = `긴 호스트 작업을 실행해 주세요.\nhttps://example.test/download?${"unbroken-link-segment".repeat(90)}`;

const mock = http.createServer(async (request, response) => {
  let raw = ""; for await (const chunk of request) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  if (request.url !== "/v1/chat/completions") { response.writeHead(404).end(); return; }
  if (!body.tools) {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: JSON.stringify({ riskLevel: 3, explanation }) }, finish_reason: "stop" }] }));
    return;
  }
  const toolResults = (body.messages || []).filter(message => message.role === "tool" && message.name === "host_computer");
  response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  if (!toolResults.length) {
    const args = {
      action: "run_shell",
      shell: process.platform === "win32" ? "powershell" : "bash",
      command,
      timeout_seconds: 60,
      qa_rows: Array.from({ length: 28 }, (_, index) => `row-${String(index + 1).padStart(2, "0")}`),
    };
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "beta12-host-call", type: "function", function: { name: "host_computer", arguments: JSON.stringify(args) } }] }, finish_reason: "tool_calls" }] })}\n\ndata: [DONE]\n\n`);
    return;
  }
  response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "The command completed unexpectedly." }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
});
mock.listen(0, "127.0.0.1"); await once(mock, "listening");

const reserve = http.createServer(); reserve.listen(0, "127.0.0.1"); await once(reserve, "listening");
const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
const root = `http://127.0.0.1:${port}`;
const appDir = process.env.BETA12_APP_DIR ? path.resolve(process.env.BETA12_APP_DIR) : process.cwd();
const staged = Boolean(process.env.BETA12_APP_DIR);
const runtime = process.env.BETA12_NODE || process.execPath;
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
async function waitForSnapshot(conversationId, predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await api(`/api/chat/${conversationId}`);
    if (response.status === 404) { await delay(50); continue; }
    assert.ok(response.ok && response.body);
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffered = "";
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buffered += decoder.decode(value, { stream: true }); const records = buffered.split(/\r?\n\r?\n/); buffered = records.pop() || "";
        for (const record of records) for (const line of record.split(/\r?\n/)) {
          if (!line.startsWith("data: {")) continue;
          const snapshot = JSON.parse(line.slice(6)); if (predicate(snapshot)) return snapshot;
        }
      }
    } finally { await reader.cancel().catch(() => undefined); }
    await delay(50);
  }
  throw new Error(`Expected chat snapshot was not received for ${conversationId}.`);
}

try {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try { if ((await fetch(`${root}/api/auth/status`)).ok) break; } catch {}
    if (attempt === 149) throw new Error(`Server did not start.\n${logs}`);
    await delay(100);
  }
  const setup = await api("/api/auth/setup", "POST", { username: "beta12qa", displayName: "Beta 12 QA", password: "Beta12-Local-QA-2026" });
  assert.equal(setup.status, 201); cookie = setup.headers.get("set-cookie").split(";")[0];
  const config = await json("/api/config");
  const model = { id: "beta12-model", sourceModel: "beta12-model", name: "Beta 12 model", connectionId: "qa", isAlias: false, visible: true, reasoningSupported: false, reasoningPresets: [], contextWindowTokens: 4096 };
  config.connections = [{ id: "qa", name: "QA", driver: "openai", baseUrl: `http://127.0.0.1:${mock.address().port}/v1`, apiKey: "", models: [model] }];
  config.models = [model]; config.preferences.language = "ko"; config.experimental.hostComputerTool = true;
  config.harnessSettings.hostTrustMode = "none"; config.harnessSettings.titleEnabled = false;
  await json("/api/config", "PUT", config);

  const stamp = new Date().toISOString(); const conversationId = "beta12-approval"; const branchId = "main";
  const requestMessage = { id: "beta12-request", role: "user", content: longRequestContent, createdAt: stamp };
  await json("/api/conversations", "POST", { id: conversationId, title: "Beta 12 approval", modelId: model.id, activeBranchId: branchId, createdAt: stamp, updatedAt: stamp, branches: [{ id: branchId, name: "Main", messages: [requestMessage], createdAt: stamp, updatedAt: stamp }] });
  await json("/api/chat", "POST", { conversationId, branchId, assistantMessageId: "beta12-response", modelId: model.id, messages: [requestMessage], tools: { hostComputer: true }, clientContext: { language: "ko", locale: "ko-KR", timeZone: "Asia/Seoul" } });
  await waitForSnapshot(conversationId, snapshot => snapshot.status === "waiting" && snapshot.message.toolEvents?.some(event => event.id === "beta12-host-call" && event.status === "waiting"));

  const chrome = [process.env.BETA12_BROWSER_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find(candidate => candidate && existsSync(candidate));
  assert.ok(chrome, "Chrome or Edge is required for Beta 12 browser QA.");
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  const context = await browser.newContext({ viewport: { width: 820, height: 760 }, extraHTTPHeaders: { cookie } });
  const page = await context.newPage(); const browserErrors = [];
  page.on("pageerror", error => browserErrors.push(error.stack || error.message));
  page.on("console", message => { if (message.type() === "error") browserErrors.push(message.text()); });
  await page.goto(`${root}/chat/${conversationId}`, { waitUntil: "domcontentloaded" });
  const messageMetrics = await page.locator(".user-message .message-bubble").evaluate(element => {
    const rect = element.getBoundingClientRect(); const threadRect = element.closest(".thread").getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      threadLeft: threadRect.left,
      threadRight: threadRect.right,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      overflowWrap: getComputedStyle(element).overflowWrap,
    };
  });
  assert.ok(messageMetrics.left >= messageMetrics.threadLeft - 1 && messageMetrics.right <= messageMetrics.threadRight + 1, JSON.stringify(messageMetrics));
  assert.ok(messageMetrics.scrollWidth <= messageMetrics.clientWidth + 1, JSON.stringify(messageMetrics));
  assert.ok(messageMetrics.documentScrollWidth <= messageMetrics.documentClientWidth, JSON.stringify(messageMetrics));
  assert.equal(messageMetrics.overflowWrap, "anywhere");
  const card = page.locator(".host-approval-card"); await card.waitFor();
  await card.locator("summary").click();
  const metrics = await card.evaluate(element => {
    const cardRect = element.getBoundingClientRect();
    const body = element.querySelector(".host-approval-body");
    const explanationElement = body.querySelector("p");
    const details = body.querySelector("details");
    const jsonElement = body.querySelector(".structured-json");
    const explanationStyle = getComputedStyle(explanationElement); const jsonStyle = getComputedStyle(jsonElement);
    explanationElement.scrollTop = explanationElement.scrollHeight;
    jsonElement.scrollTop = jsonElement.scrollHeight; jsonElement.scrollLeft = jsonElement.scrollWidth;
    return {
      viewportWidth: document.documentElement.clientWidth,
      cardLeft: cardRect.left,
      cardRight: cardRect.right,
      bodyRight: body.getBoundingClientRect().right,
      detailsRight: details.getBoundingClientRect().right,
      jsonRight: jsonElement.getBoundingClientRect().right,
      explanationClientHeight: explanationElement.clientHeight,
      explanationScrollHeight: explanationElement.scrollHeight,
      explanationScrollTop: explanationElement.scrollTop,
      explanationLineHeight: parseFloat(explanationStyle.lineHeight),
      explanationOverflowY: explanationStyle.overflowY,
      jsonClientWidth: jsonElement.clientWidth,
      jsonScrollWidth: jsonElement.scrollWidth,
      jsonClientHeight: jsonElement.clientHeight,
      jsonScrollHeight: jsonElement.scrollHeight,
      jsonScrollLeft: jsonElement.scrollLeft,
      jsonScrollTop: jsonElement.scrollTop,
      jsonOverflowX: jsonStyle.overflowX,
      jsonOverflowY: jsonStyle.overflowY,
    };
  });
  assert.ok(metrics.cardLeft >= 0 && metrics.cardRight <= metrics.viewportWidth + 1, JSON.stringify(metrics));
  assert.ok(metrics.detailsRight <= metrics.bodyRight + 1 && metrics.jsonRight <= metrics.detailsRight + 1, JSON.stringify(metrics));
  assert.ok(metrics.explanationClientHeight <= metrics.explanationLineHeight * 6 + 2, JSON.stringify(metrics));
  assert.ok(metrics.explanationScrollHeight > metrics.explanationClientHeight && metrics.explanationScrollTop > 0, JSON.stringify(metrics));
  assert.equal(metrics.explanationOverflowY, "auto");
  assert.ok(metrics.jsonScrollWidth > metrics.jsonClientWidth && metrics.jsonScrollLeft > 0, JSON.stringify(metrics));
  assert.ok(metrics.jsonScrollHeight > metrics.jsonClientHeight && metrics.jsonScrollTop > 0, JSON.stringify(metrics));
  assert.equal(metrics.jsonOverflowX, "auto"); assert.equal(metrics.jsonOverflowY, "auto");
  assert.deepEqual(browserErrors, []);

  if (process.env.BETA12_QA_KEEP === "1") {
    console.log(`QA_READY ${root}/chat/${conversationId} beta12qa Beta12-Local-QA-2026`);
    await new Promise(resolve => { process.once("SIGINT", resolve); process.once("SIGTERM", resolve); });
    console.log("QA_STOPPED");
  } else {
    await page.getByRole("button", { name: "허용" }).click();
    await card.waitFor({ state: "detached" });
    await waitForSnapshot(conversationId, snapshot => snapshot.status === "running" && snapshot.message.toolEvents?.some(event => event.id === "beta12-host-call" && event.status === "calling"));
    const stopButton = page.getByRole("button", { name: "생성 중단" }); await stopButton.waitFor(); await stopButton.click();
    const stopped = await waitForSnapshot(conversationId, snapshot => snapshot.status === "stopped");
    assert.equal(stopped.message.toolEvents.find(event => event.id === "beta12-host-call")?.status, "error");
    await delay(1_000); assert.equal(existsSync(sentinel), false, "The cancelled host command still reached its final file write.");
  }

  await context.close();
  console.log("PASS Beta 12: wrapped long user links, bounded six-line approval explanation, contained two-axis tool details, and stop-button host command cancellation");
} catch (error) {
  console.error(logs); throw error;
} finally {
  if (browser) await browser.close();
  server.kill(); mock.close();
  if (server.exitCode === null) await Promise.race([once(server, "exit"), delay(5_000)]);
  await rm(data, { recursive: true, force: true });
}
