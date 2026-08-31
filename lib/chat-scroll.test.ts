import assert from "node:assert/strict";
import test from "node:test";
import { isNearScrollBottom } from "./chat-scroll.ts";

test("auto-follow remains enabled at or near the bottom", () => {
  assert.equal(isNearScrollBottom({ scrollTop: 600, clientHeight: 400, scrollHeight: 1000 }), true);
  assert.equal(isNearScrollBottom({ scrollTop: 555, clientHeight: 400, scrollHeight: 1000 }), true);
});

test("manual scrolling away from the bottom disables auto-follow", () => {
  assert.equal(isNearScrollBottom({ scrollTop: 500, clientHeight: 400, scrollHeight: 1000 }), false);
  assert.equal(isNearScrollBottom({ scrollTop: -20, clientHeight: 400, scrollHeight: 1000 }), false);
});
