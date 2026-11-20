import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { anthropicChatFetch, toAnthropicMessages, toAnthropicRequest } from "./anthropic-bridge.ts";
import { legacyAnthropicModel } from "./reasoning-capabilities.ts";
import { providerRequestBody } from "./provider-requests.ts";
import { connectionHeaders, modelsEndpoint } from "./connection-drivers.ts";
import { samplingRequestFields } from "./sampling-params.ts";

test("chat messages become a system prompt and Messages API turns with tool results", () => {
  const { system, messages } = toAnthropicMessages([
    { role: "system", content: "Be brief." },
    { role: "user", content: [{ type: "text", text: "Look" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] },
    { role: "assistant", content: "Checking", reasoning_content: "hidden", tool_calls: [{ id: "call_1", type: "function", function: { name: "search", arguments: "{\"q\":\"x\"}" } }] },
    { role: "tool", tool_call_id: "call_1", content: "found" },
    { role: "user", content: "thanks" },
  ]);
  assert.equal(system, "Be brief.");
  assert.deepEqual(messages.map(message => message.role), ["user", "assistant", "user"]);
  assert.deepEqual(messages[0].content, [{ type: "text", text: "Look" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }]);
  assert.deepEqual(messages[1].content, [{ type: "text", text: "Checking" }, { type: "tool_use", id: "call_1", name: "search", input: { q: "x" } }]);
  assert.deepEqual(messages[2].content, [{ type: "tool_result", tool_use_id: "call_1", content: [{ type: "text", text: "found" }] }, { type: "text", text: "thanks" }]);
});

test("requests drop sampling, map effort and only ask current models for adaptive thinking", () => {
  const current = toAnthropicRequest({ model: "claude-opus-5-5", messages: [{ role: "user", content: "hi" }], temperature: 0.2, top_p: 0.9, reasoning_effort: "high", max_tokens: 1000, tools: [{ type: "function", function: { name: "f", parameters: { type: "object", properties: {} } } }] });
  assert.equal("temperature" in current, false);
  assert.equal("top_p" in current, false);
  assert.deepEqual(current.output_config, { effort: "high" });
  assert.deepEqual(current.thinking, { type: "adaptive", display: "summarized" });
  assert.equal(current.max_tokens, 1000);
  assert.equal((current.tools?.[0] as { name?: string } | undefined)?.name, "f");
  const legacy = toAnthropicRequest({ model: "claude-haiku-4-5", messages: [{ role: "user", content: "hi" }], reasoning_effort: "high" });
  assert.equal(legacy.thinking, undefined);
  assert.equal(legacy.output_config, undefined);
  assert.ok(legacyAnthropicModel("claude-3-5-sonnet-20241022") && legacyAnthropicModel("claude-sonnet-4-20250514") && legacyAnthropicModel("claude-opus-4-1"));
  assert.ok(!legacyAnthropicModel("claude-sonnet-4-6") && !legacyAnthropicModel("claude-sonnet-5-5") && !legacyAnthropicModel("claude-fable-5-2"));
});

test("the bridge streams Messages API events back as Chat Completions chunks", async () => {
  let seen: { path?: string; key?: string; body?: Record<string, unknown> } = {};
  const events = [
    { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "pondering" } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Hello" } },
    { type: "content_block_stop", index: 1 },
    { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "toolu_1", name: "search", input: {} } },
    { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "{\"q\":" } },
    { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "\"x\"}" } },
    { type: "content_block_stop", index: 2 },
    { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 30 } },
    { type: "message_stop" },
  ];
  const server = createServer((request, response) => {
    let raw = ""; request.on("data", chunk => raw += chunk);
    request.on("end", () => {
      seen = { path: request.url, key: String(request.headers["x-api-key"] || request.headers.authorization || "").replace(/^Bearer /, ""), body: JSON.parse(raw) };
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const event of events) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      response.end();
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    const response = await anthropicChatFetch(`${base}/chat/completions`, { method: "POST", headers: connectionHeaders({ driver: "anthropic", apiKey: "sk-test" }), body: JSON.stringify({ model: "claude-opus-5-5", stream: true, messages: [{ role: "user", content: "hi" }] }) });
    assert.equal(response.status, 200);
    const text = await response.text();
    const chunks = text.split("\n\n").filter(Boolean).map(record => record.replace(/^data: /, ""));
    assert.equal(chunks.at(-1), "[DONE]");
    const payloads = chunks.slice(0, -1).map(chunk => JSON.parse(chunk));
    const deltas = payloads.flatMap(payload => payload.choices.map((choice: { delta: Record<string, unknown> }) => choice.delta));
    assert.equal(deltas.map(delta => delta.reasoning_content || "").join(""), "pondering");
    assert.equal(deltas.map(delta => delta.content || "").join(""), "Hello");
    const args = deltas.flatMap(delta => (delta.tool_calls as Array<{ function: { arguments?: string } }> | undefined) || []).map(call => call.function.arguments || "").join("");
    assert.equal(args, "{\"q\":\"x\"}");
    assert.ok(payloads.some(payload => payload.choices[0]?.finish_reason === "tool_calls"));
    assert.deepEqual(payloads.at(-1).usage, { prompt_tokens: 12, completion_tokens: 30, total_tokens: 42 });
    assert.equal(seen.path, "/v1/messages");
    assert.equal(seen.key, "sk-test");
    assert.equal(seen.body?.model, "claude-opus-5-5");
  } finally { server.close(); }
});

test("Gemini requests keep only the fields its OpenAI endpoint accepts", () => {
  const body = providerRequestBody("google", { model: "gemini-2.5-flash", reasoning_effort: "xhigh", messages: [{ role: "assistant", content: "a", reasoning_content: "r" }] });
  assert.equal(body.reasoning_effort, "high");
  assert.deepEqual(body.messages, [{ role: "assistant", content: "a" }]);
  assert.deepEqual(samplingRequestFields({ temperature: 0.7, topK: 40, topP: 0.9, minP: 0.05 }, "google"), { temperature: 0.7, top_p: 0.9 });
  assert.deepEqual(samplingRequestFields({ temperature: 0.7, topK: 40 }, "anthropic"), {});
  assert.deepEqual(samplingRequestFields({ temperature: 0.7, topK: 40 }, "lmstudio"), { temperature: 0.7, top_k: 40 });
  assert.equal(modelsEndpoint("anthropic", "https://api.anthropic.com/v1"), "https://api.anthropic.com/v1/models?limit=1000");
  assert.equal(modelsEndpoint("google", "https://generativelanguage.googleapis.com/v1beta/openai/"), "https://generativelanguage.googleapis.com/v1beta/openai/models");
});
