import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const seenAuthorization = [];
const mcp = http.createServer(async (request, response) => {
  if (request.method === "DELETE") { response.writeHead(200).end(); return; }
  if (request.method !== "POST" || request.url !== "/mcp") { response.writeHead(404).end(); return; }
  seenAuthorization.push(request.headers.authorization || "");
  let raw = "";
  for await (const chunk of request) raw += chunk;
  const message = JSON.parse(raw);
  if (message.id === undefined) { response.writeHead(202).end(); return; }
  let result;
  if (message.method === "initialize") result = { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "Neural MCP QA", version: "1.0.0" } };
  else if (message.method === "tools/list") result = { tools: [{ name: "echo", description: "Echo text", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }] };
  else { response.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Unknown method" } })); return; }
  response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
});
mcp.listen(0, "127.0.0.1"); await once(mcp, "listening");

const data = await mkdtemp(path.join(os.tmpdir(), "neural-mcp-"));
const reserve = http.createServer(); reserve.listen(0, "127.0.0.1"); await once(reserve, "listening");
const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
const root = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["scripts/start-server.mjs", "start"], {
  cwd: process.cwd(), windowsHide: true,
  env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: String(port), NEURAL_CHAT_DATA_DIR: data, NEURAL_CHAT_DB_PATH: path.join(data, "qa.sqlite3") },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "", cookie = "";
server.stdout.on("data", chunk => logs = (logs + chunk).slice(-12000));
server.stderr.on("data", chunk => logs = (logs + chunk).slice(-12000));
async function request(route, method = "GET", body) {
  return fetch(root + route, { method, headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
}
async function json(route, method = "GET", body) {
  const response = await request(route, method, body), value = await response.json().catch(() => ({}));
  assert.ok(response.ok, `${method} ${route}: ${response.status} ${JSON.stringify(value)}`);
  return value;
}

try {
  for (let index = 0; index < 150; index++) {
    try { if ((await fetch(`${root}/api/auth/status`)).ok) break; } catch {}
    if (index === 149) throw new Error(`Server did not start.\n${logs}`);
    await delay(100);
  }
  const setup = await request("/api/auth/setup", "POST", { username: "mcpqa", displayName: "MCP QA", password: "Mcp-QA-Password-2026" });
  assert.equal(setup.status, 201); cookie = setup.headers.get("set-cookie").split(";")[0];

  const plans = (await json("/api/plans")).plans;
  assert.equal(plans.length, 1);
  const enabledPlan = { ...plans[0], mcpEnabled: true, maxMcpConnections: 2 };
  await json(`/api/plans/${enabledPlan.id}`, "PUT", enabledPlan);

  const base = { name: "QA MCP", description: "integration", url: `http://127.0.0.1:${mcp.address().port}/mcp`, authType: "api_key", credential: "qa-secret", enabled: true };
  const tested = await json("/api/mcp-connections/test", "POST", base);
  assert.equal(tested.toolCount, 1); assert.deepEqual(tested.tools, ["echo"]);
  assert.ok(seenAuthorization.length >= 2); assert.ok(seenAuthorization.every(value => value === "Bearer qa-secret"));

  const first = (await json("/api/mcp-connections", "POST", base)).connection;
  assert.equal(first.hasCredential, true); assert.equal("credential" in first, false);
  await json("/api/mcp-connections", "POST", { ...base, name: "QA MCP 2", authType: "none", credential: "" });
  const overLimit = await request("/api/mcp-connections", "POST", { ...base, name: "QA MCP 3" });
  assert.equal(overLimit.status, 409);
  const listed = await json("/api/mcp-connections");
  assert.equal(listed.connections.length, 2); assert.ok(listed.connections.every(item => !("credential" in item)));

  const backupCredentials = encodeURIComponent(JSON.stringify({ username: "mcpqa", password: "Mcp-QA-Password-2026" }));
  const backupResponse = await fetch(`${root}/api/backup?scope=personal`, { headers: { cookie, "X-Backup-Credentials": backupCredentials }, signal: AbortSignal.timeout(60_000) });
  const backup = new Uint8Array(await backupResponse.arrayBuffer());
  assert.equal(backupResponse.status, 200); assert.equal(Buffer.from(backup.subarray(0, 8)).toString(), "NNUIENC1");
  for (const connection of listed.connections) assert.equal((await request(`/api/mcp-connections/${connection.id}`, "DELETE")).status, 204);
  assert.equal((await json("/api/mcp-connections")).connections.length, 0);
  const restore = await fetch(`${root}/api/backup`, { method: "POST", headers: { cookie, "Content-Type": "application/octet-stream", "X-Backup-Credentials": backupCredentials, "X-Backup-Scope": "personal", "X-Restore-Mode": "replace" }, body: backup, signal: AbortSignal.timeout(60_000) });
  assert.equal(restore.status, 200, await restore.text());
  const restored = await json("/api/mcp-connections");
  assert.equal(restored.connections.length, 2); assert.ok(restored.connections.every(item => !("credential" in item)));
  assert.equal((await json("/api/mcp-connections/test", "POST", { ...base, id: first.id, credential: "" })).toolCount, 1, "restored credentials remain usable");

  const changedAuth = await request(`/api/mcp-connections/${first.id}`, "PUT", { ...base, id: first.id, authType: "oauth", credential: "" });
  assert.equal(changedAuth.status, 400, "changing auth type must not reuse the previous credential");

  const disabledPlan = { ...enabledPlan, mcpEnabled: false, maxMcpConnections: 0 };
  await json(`/api/plans/${enabledPlan.id}`, "PUT", disabledPlan);
  const preserved = await json("/api/mcp-connections");
  assert.equal(preserved.connections.length, 2); assert.equal(preserved.entitlement.enabled, false);
  assert.equal((await request("/api/mcp-connections/test", "POST", base)).status, 403);
  assert.equal((await request(`/api/mcp-connections/${first.id}`, "DELETE")).status, 204, "disabled plans can still remove saved connections");
  console.log("MCP integration passed: Streamable HTTP discovery, auth/redaction, plan limits, disabled-plan preservation, and encrypted backup restore.");
} finally {
  server.kill(); mcp.close();
  await Promise.race([once(server, "exit"), delay(5_000)]).catch(() => undefined);
  await rm(data, { recursive: true, force: true });
}
