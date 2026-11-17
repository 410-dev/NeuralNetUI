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
