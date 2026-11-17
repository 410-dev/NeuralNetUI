import assert from "node:assert/strict";
import test from "node:test";
import { parseCompactCommand } from "./compact-command.ts";

test("only the exact /compact forms are commands", () => {
  assert.equal(parseCompactCommand("/compact"), "default");
  assert.equal(parseCompactCommand("  /compact  "), "default");
  assert.equal(parseCompactCommand("/compact summarize"), "summarize");
  assert.equal(parseCompactCommand("/COMPACT   Summarize"), "summarize");
  assert.equal(parseCompactCommand("/compact\nsummarize"), "summarize");
  for (const message of ["/compact please", "/compact summarize now", "explain /compact", "/compacted", "/compact\nsummarize later", "compact"]) assert.equal(parseCompactCommand(message), undefined, message);
});

test("autocomplete narrows as the command is typed and disappears for messages", async () => {
  const { slashSuggestions } = await import("./compact-command.ts");
  const names = (draft: string) => slashSuggestions(draft).map(item => item.command);
  assert.deepEqual(names("/"), ["/compact", "/compact summarize"]);
  assert.deepEqual(names("/co"), ["/compact", "/compact summarize"]);
  assert.deepEqual(names("/compact"), ["/compact", "/compact summarize"]);
  assert.deepEqual(names("/compact s"), ["/compact summarize"]);
  assert.deepEqual(names("/compact "), ["/compact summarize"]);
  assert.deepEqual(names("/compact summarize"), ["/compact summarize"]);
  assert.deepEqual(names("/compact please"), []);
  assert.deepEqual(names("/x"), []);
  assert.deepEqual(names("hello /compact"), []);
});
