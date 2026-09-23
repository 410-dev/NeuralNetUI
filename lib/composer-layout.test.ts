import assert from "node:assert/strict";
import test from "node:test";
import { shouldExpandComposer } from "./composer-layout.ts";

test("the composer expands before text reaches the inline wrap boundary", () => {
  assert.equal(shouldExpandComposer(false, "draft", 200, 181), false);
  assert.equal(shouldExpandComposer(false, "draft", 200, 182), true);
  assert.equal(shouldExpandComposer(false, "draft", 200, 199), true);
});

test("stacked content, explicit newlines, and cramped controls still expand the composer", () => {
  assert.equal(shouldExpandComposer(true, "draft", 300, 30), true);
  assert.equal(shouldExpandComposer(false, "a\nb", 300, 30), true);
  assert.equal(shouldExpandComposer(false, "draft", 149, 30), true);
});
