import assert from "node:assert/strict";
import test from "node:test";
import { usageLevel, usagePopoverPlacement } from "./usage-popover.ts";

test("usage popover remains inside a narrow viewport", () => {
  const placement = usagePopoverPlacement(
    { width: 529, height: 361 },
    { top: 278, right: 377 },
  );

  assert.equal(placement.left, 77);
  assert.equal(placement.bottom, 95);
  assert.equal(placement.width, 300);
  assert.equal(placement.maxHeight, 254);
  assert.ok(placement.left >= 12);
  assert.ok(placement.left + placement.width <= 529 - 12);
  assert.ok(361 - placement.bottom - placement.maxHeight >= 12);
});

test("usage popover width contracts for phone viewports", () => {
  const placement = usagePopoverPlacement(
    { width: 240, height: 320 },
    { top: 250, right: 228 },
  );

  assert.deepEqual(placement, {
    left: 12,
    bottom: 82,
    width: 216,
    maxHeight: 226,
  });
});

test("usage meter turns yellow at 80% and red at 90%", () => {
  assert.equal(usageLevel(0), "normal");
  assert.equal(usageLevel(79.9), "normal");
  assert.equal(usageLevel(80), "warning");
  assert.equal(usageLevel(89.9), "warning");
  assert.equal(usageLevel(90), "critical");
  assert.equal(usageLevel(100), "critical");
});
