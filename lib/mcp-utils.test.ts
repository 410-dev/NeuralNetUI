import assert from "node:assert/strict";
import test from "node:test";
import { classifyMcpAddress, describeMcpFailure, mcpToolAlias } from "./mcp-utils.ts";

test("MCP tool aliases are provider-scoped, sanitized, and API-safe",()=>{
  assert.equal(mcpToolAlias("a1b2c3d4-1111","search docs"),"mcp_a1b2c3d4_search_docs");
  assert.ok(mcpToolAlias("a1b2c3d4-1111","x".repeat(100)).length<=64);
  assert.notEqual(mcpToolAlias("a1b2c3d4-1111","search"),mcpToolAlias("ffffffff-1111","search"));
});

test("MCP network classification blocks metadata ranges and identifies private targets",()=>{
  assert.equal(classifyMcpAddress("169.254.169.254"),"blocked");
  assert.equal(classifyMcpAddress("127.0.0.1"),"private");
  assert.equal(classifyMcpAddress("10.0.0.8"),"private");
  assert.equal(classifyMcpAddress("8.8.8.8"),"public");
  assert.equal(classifyMcpAddress("::1"),"private");
  assert.equal(classifyMcpAddress("::ffff:7f00:1"),"blocked");
});

test("MCP server failures read as one message with the upstream status and a hint", () => {
  const cloudflare = Object.assign(new Error('Error POSTing to endpoint: {"title":"Error 502: Bad gateway","detail":"The origin web server returned an invalid or incomplete response to Cloudflare.","status":502}'), { status: 502 });
  const message = describeMcpFailure(cloudflare, "https://mcp.example.com/mcp");
  assert.match(message, /^MCP 서버가 HTTP 502로 응답했습니다: Error 502: Bad gateway — The origin web server/);
  assert.match(message, /http\/https/);
  assert.match(describeMcpFailure(Object.assign(new Error("Error POSTing to endpoint: not found"), { status: 404 }), "https://mcp.example.com"), /\/mcp 경로/);
  assert.doesNotMatch(describeMcpFailure(Object.assign(new Error("Error POSTing to endpoint: not found"), { status: 404 }), "https://mcp.example.com/mcp"), /\/mcp 경로/);
  assert.match(describeMcpFailure(Object.assign(new Error("Error POSTing to endpoint: <html><body>Bad</body></html>"), { status: 401 }), "https://x.example/mcp"), /^MCP 서버가 HTTP 401로 응답했습니다\. 인증/);
  assert.equal(describeMcpFailure(Object.assign(new Error("Unauthorized"), { name: "UnauthorizedError" }), "https://x.example/mcp"), "MCP 서버가 HTTP 401로 응답했습니다: Unauthorized 인증 방식과 토큰 또는 API 키를 확인하세요.");
  assert.equal(describeMcpFailure(Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }), "https://x.example/mcp"), "MCP 서버에 연결하지 못했습니다 (ENOTFOUND): fetch failed");
});

test("only flagged links on the connection's own host become storage imports", async () => {
  const { mcpStorageLink } = await import("./mcp-utils.ts");
  const link = (meta: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ type: "resource_link", uri: "https://elsewhere.example/x", name: "clip.webm", size: 1234, _meta: { "nnui/saveToStorage": true, "nnui/path": "files/abcdefghijklmnop0123/clip.webm", ...meta }, ...extra });
  assert.deepEqual(mcpStorageLink(link({ sha256: "A".repeat(64) }), "https://mcp.example/yt/mcp"), { url: "https://mcp.example/yt/files/abcdefghijklmnop0123/clip.webm", name: "clip.webm", size: 1234, sha256: "a".repeat(64) });
  assert.equal(mcpStorageLink(link({ "nnui/saveToStorage": false }), "https://mcp.example/mcp"), undefined);
  assert.equal(mcpStorageLink(link({ "nnui/path": "//evil.example/files/abcdefghijklmnop0123/x" }), "https://mcp.example/mcp"), undefined);
  assert.equal(mcpStorageLink(link({ "nnui/path": "files/../../etc/passwd" }), "https://mcp.example/mcp"), undefined);
  assert.equal(mcpStorageLink(link({}, { size: 0 }), "https://mcp.example/mcp"), undefined);
  assert.equal(mcpStorageLink({ type: "text", text: "hi" }, "https://mcp.example/mcp"), undefined);
});
