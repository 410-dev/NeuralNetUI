import assert from "node:assert/strict";
import test from "node:test";
import { summarize, toolsWithDetails, trimDescription, trimSchema } from "./mcp-tool-definitions.ts";

test("trimming cuts descriptions but keeps the schema's structure", () => {
  const schema = { type: "object", required: ["query"], properties: {
    query: { type: "string", description: "x".repeat(900) },
    description: { type: "string", description: "A field named description" },
    mode: { type: "string", enum: ["a", "b"], description: "short" } } };
  const trimmed = trimSchema(schema, 300);
  assert.equal(trimmed.properties.query.description.length, 301);
  assert.ok(trimmed.properties.query.description.endsWith("…"));
  assert.deepEqual(trimmed.properties.description, schema.properties.description);
  assert.deepEqual(trimmed.properties.mode, schema.properties.mode);
  assert.deepEqual(trimmed.required, ["query"]);
  assert.equal(trimDescription("y".repeat(1200)).length, 1001);
  assert.equal(trimDescription("short"), "short");
});

test("on-demand summaries are the first sentence", () => {
  assert.equal(summarize("Lists email threads. It supports pagination and filters."), "Lists email threads.");
  assert.equal(summarize("Creates an event\\n\\nMore text").split("\\n")[0], "Creates an event");
  assert.ok(summarize("z".repeat(500)).length <= 161);
});

test("details read in the conversation are remembered by tool name", () => {
  const history = [
    { name: "mcp_b1d9153f_get_tool_details", status: "completed", result: { tools: [{ name: "search_threads" }, { name: "get_thread" }] } },
    { name: "mcp_b1d9153f_get_tool_details", status: "error", result: { tools: [{ name: "send_message" }] } },
    { name: "mcp_db798931_get_tool_details", status: "completed", result: { tools: [{ name: "create_event" }] } },
    { name: "mcp_b1d9153f_send_message", status: "completed", result: { executed: false, tools: [{ name: "send_message" }] } },
  ];
  assert.deepEqual([...toolsWithDetails(history, "mcp_b1d9153f_")].sort(), ["get_thread", "search_threads", "send_message"]);
});
