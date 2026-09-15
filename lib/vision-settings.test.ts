import assert from "node:assert/strict";
import test from "node:test";
import { resolvedVisionSettings } from "./vision-settings.ts";

test("vision settings default to original images and retain a bounded option", () => {
  assert.deepEqual(resolvedVisionSettings(), { mode: "original", maxEdgePixels: 1024 });
  assert.deepEqual(resolvedVisionSettings({ visionImageMode: "max-resolution", visionMaxEdgePixels: 640 }), { mode: "max-resolution", maxEdgePixels: 640 });
});

test("vision settings preserve original mode and clamp malformed pixel limits", () => {
  assert.deepEqual(resolvedVisionSettings({ visionImageMode: "original", visionMaxEdgePixels: 64 }), { mode: "original", maxEdgePixels: 128 });
  assert.equal(resolvedVisionSettings({ visionMaxEdgePixels: 99_999 }).maxEdgePixels, 8192);
});
