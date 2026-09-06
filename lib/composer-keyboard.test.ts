import assert from "node:assert/strict";
import test from "node:test";
import { shouldSubmitComposerOnEnter } from "./composer-keyboard.ts";

test("desktop Enter submits while Shift+Enter inserts a line break", () => {
  assert.equal(shouldSubmitComposerOnEnter({ key: "Enter", shiftKey: false, isComposing: false, mobileInput: false }), true);
  assert.equal(shouldSubmitComposerOnEnter({ key: "Enter", shiftKey: true, isComposing: false, mobileInput: false }), false);
});

test("mobile Enter and IME composition never submit", () => {
  assert.equal(shouldSubmitComposerOnEnter({ key: "Enter", shiftKey: false, isComposing: false, mobileInput: true }), false);
  assert.equal(shouldSubmitComposerOnEnter({ key: "Enter", shiftKey: false, isComposing: true, mobileInput: false }), false);
});

test("non-Enter keys never submit", () => {
  assert.equal(shouldSubmitComposerOnEnter({ key: "a", shiftKey: false, isComposing: false, mobileInput: false }), false);
});
