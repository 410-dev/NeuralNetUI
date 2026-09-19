import assert from "node:assert/strict";
import test from "node:test";
import { classifyMcpAddress, mcpToolAlias } from "./mcp-utils.ts";

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
