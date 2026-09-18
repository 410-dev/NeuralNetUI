import assert from "node:assert/strict";
import test from "node:test";
import { returnsFromIdle } from "./keyboard-return.ts";

test("a key press counts as a return only after a full idle minute", () => {
  assert.equal(returnsFromIdle(0, 59_999, 60_000), false);
  assert.equal(returnsFromIdle(0, 60_000, 60_000), true);
  assert.equal(returnsFromIdle(10_000, 30_000, 60_000), false);
});
