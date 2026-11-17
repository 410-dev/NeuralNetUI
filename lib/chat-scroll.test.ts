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

test("a live box only stops following when the person scrolls", async () => {
  const { followAfterScroll } = await import("./chat-scroll.ts");
  assert.equal(followAfterScroll(false, true, 0, 10_000), true, "text outran the scroll: keep following");
  assert.equal(followAfterScroll(false, true, 9_800, 10_000), false, "a wheel or touch just now: stop");
  assert.equal(followAfterScroll(false, false, 0, 10_000), false, "already stopped stays stopped");
  assert.equal(followAfterScroll(true, false, 9_900, 10_000), true, "back at the bottom resumes");
});
