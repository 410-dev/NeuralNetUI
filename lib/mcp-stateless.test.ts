import assert from "node:assert/strict";
import test from "node:test";
import { elicitationRequests, parseRpcResponse, statelessToolCall, usesStatelessProtocol } from "./mcp-stateless.ts";

const challenge = { resultType: "input_required", requestState: "state-1", inputRequests: { approval_choice: { method: "elicitation/create", params: { mode: "form", message: "Allow access to 3 threads?",
  requestedSchema: { type: "object", required: ["approval_choice"], properties: { approval_choice: { type: "string", title: "Allow this app to use search_threads?", enum: ["ALLOW_ONCE", "ALLOW_TOOL_ALWAYS", "DENY_ONCE"], enumNames: ["Allow once", "Always allow this tool", "Don't allow"] } } } } } } };

test("Google's servers use the stateless transport", () => {
  assert.equal(usesStatelessProtocol("https://gmailmcp.googleapis.com/mcp/v1"), true);
  assert.equal(usesStatelessProtocol("https://example.com/mcp"), false);
});

test("responses are read from JSON or an event stream", () => {
  assert.deepEqual(parseRpcResponse('{"jsonrpc":"2.0","id":1,"result":{"a":1}}').result, { a: 1 });
  assert.deepEqual(parseRpcResponse('event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\nevent: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"b":2}}\n\n').result, { b: 2 });
});

test("input requests become fields with labelled options", () => {
  const [request] = elicitationRequests(challenge);
  assert.equal(request.key, "approval_choice");
  assert.equal(request.message, "Allow access to 3 threads?");
  assert.deepEqual(request.fields[0].options, [{ value: "ALLOW_ONCE", label: "Allow once" }, { value: "ALLOW_TOOL_ALWAYS", label: "Always allow this tool" }, { value: "DENY_ONCE", label: "Don't allow" }]);
  assert.equal(request.fields[0].required, true);
});

test("a call asking for approval is sent again with the person's answer", async () => {
  const sent: Array<{ headers: Record<string, string>; body: { method: string; params: Record<string, unknown> } }> = [];
  const fakeFetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)); sent.push({ headers: init?.headers as Record<string, string>, body });
    const result = sent.length === 1 ? challenge : { resultType: "complete", content: [{ type: "text", text: "3 threads" }] };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const asked: string[] = [];
  const result = await statelessToolCall("https://gmailmcp.googleapis.com/mcp/v1", async () => "token", "search_threads", { query: "is:unread" }, { fetch: fakeFetch, elicit: async request => { asked.push(request.message); return { action: "accept", content: { approval_choice: "ALLOW_ONCE" } }; } });
  assert.deepEqual(result.content, [{ type: "text", text: "3 threads" }]);
  assert.deepEqual(asked, ["Allow access to 3 threads?"]);
  assert.equal(sent[0].headers["MCP-Protocol-Version"], "2026-07-28");
  assert.equal(sent[0].headers["Mcp-Method"], "tools/call");
  assert.equal(sent[0].headers["Mcp-Name"], "search_threads");
  assert.equal(sent[0].headers.Authorization, "Bearer token");
  assert.deepEqual((sent[0].body.params._meta as Record<string, unknown>)["io.modelcontextprotocol/clientCapabilities"], { elicitation: { form: {} } });
  assert.deepEqual(sent[1].body.params.arguments, { query: "is:unread" });
  assert.equal(sent[1].body.params.requestState, "state-1");
  assert.deepEqual(sent[1].body.params.inputResponses, { approval_choice: { action: "accept", content: { approval_choice: "ALLOW_ONCE" } } });
});

test("without anyone to ask, the request is declined", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const fakeFetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)); bodies.push(body.params);
    const result = bodies.length === 1 ? challenge : { resultType: "complete", isError: true, content: [{ type: "text", text: "Action canceled." }] };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
  }) as typeof fetch;
  const result = await statelessToolCall("https://gmailmcp.googleapis.com/mcp/v1", async () => "t", "get_thread", {}, { fetch: fakeFetch });
  assert.equal(result.isError, true);
  assert.deepEqual(bodies[1].inputResponses, { approval_choice: { action: "decline" } });
});
