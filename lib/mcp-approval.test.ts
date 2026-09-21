import assert from "node:assert/strict";
import test from "node:test";
import { describeMcpApproval } from "./mcp-approval.ts";

test("MCP approval explains the requested operation and redacts likely secrets",()=>{
  const text=describeMcpApproval("exec_command","Run a command",{cmd:"npm test",apiKey:"do-not-show",cwd:"C:/work"},"en");
  assert.match(text,/Run a command/);assert.match(text,/cmd: npm test/);assert.doesNotMatch(text,/do-not-show/);
});

test("MCP approval produces localized fallback copy",()=>{
  assert.match(describeMcpApproval("lookup","",{query:"문서"},"ko"),/요청 작업: query: 문서/);
});
