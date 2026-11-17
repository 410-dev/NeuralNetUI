import assert from "node:assert/strict";
import test from "node:test";
import { readApiResponse } from "./client-response.ts";

test("API responses parse as JSON and throw their error message when not OK", async () => {
  assert.deepEqual(await readApiResponse(new Response('{"toolCount":3}', { status: 200 })), { toolCount: 3 });
  await assert.rejects(readApiResponse(new Response('{"error":"MCP 서버가 HTTP 502로 응답했습니다."}', { status: 400 })), /HTTP 502로 응답/);
  await assert.rejects(readApiResponse(new Response("{}", { status: 500 })), /^Error: HTTP 500$/);
});

test("a proxy error page becomes a readable error instead of a JSON.parse failure", async () => {
  await assert.rejects(readApiResponse(new Response("error code: 502", { status: 502 })), /JSON이 아닌 응답\(HTTP 502\).*error code: 502/);
  await assert.rejects(readApiResponse(new Response("<html><h1>Bad gateway</h1></html>", { status: 502 }), "en"), /non-JSON response \(HTTP 502\).*Bad gateway/);
});
