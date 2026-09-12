import assert from "node:assert/strict";
import test from "node:test";

import { normalizeBrowserAction, normalizeBrowserViewAction, privateBrowserAddress } from "./browser-tool.ts";

test("browser address guard rejects local IPv4 and IPv6 ranges", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.8", "169.254.1.1", "::1", "fd00::1", "fe80::1"]) {
    assert.equal(privateBrowserAddress(address), true, address);
  }
  assert.equal(privateBrowserAddress("8.8.8.8"), false);
  assert.equal(privateBrowserAddress("2606:4700:4700::1111"), false);
});

test("browser action parser clamps waits and normalizes safe defaults", () => {
  assert.deepEqual(normalizeBrowserAction({ action: "open", url: "https://example.com", wait_seconds: 99, screenshot: true }), {
    action: "open", url: "https://example.com", waitSeconds: 30, screenshot: true, fullPage: false,
  });
  assert.deepEqual(normalizeBrowserAction({ action: "scroll", session_id: "abc", delta_y: -99999 }), {
    action: "scroll", sessionId: "abc", deltaY: -10_000,
  });
  assert.deepEqual(normalizeBrowserAction({ action: "new_tab", session_id: "abc", url: "https://example.org", label: "Reference", note: "Compare later" }), {
    action: "new_tab", sessionId: "abc", url: "https://example.org", label: "Reference", note: "Compare later",
  });
  assert.deepEqual(normalizeBrowserAction({ action: "set_tab_metadata", session_id: "abc", tab_id: "tab-2", label: "", note: "" }), {
    action: "set_tab_metadata", sessionId: "abc", tabId: "tab-2", label: "", note: "",
  });
  assert.deepEqual(normalizeBrowserAction({ action: "set_tab_metadata", session_id: "abc", tab_id: "tab-2", label: "Research" }), {
    action: "set_tab_metadata", sessionId: "abc", tabId: "tab-2", label: "Research", note: undefined,
  });
  assert.throws(() => normalizeBrowserAction({ action: "set_tab_metadata", session_id: "abc", tab_id: "tab-2" }), /label or note/i);
  assert.throws(() => normalizeBrowserAction({ action: "switch_tab", session_id: "abc" }), /tab_id/i);
  assert.throws(() => normalizeBrowserAction({ action: "type", session_id: "abc", target: "e1" }), /text/i);
  assert.throws(() => normalizeBrowserAction({ action: "unknown" }), /action/i);
});

test("browser view controls clamp coordinates and keep only supported modifiers", () => {
  assert.deepEqual(normalizeBrowserViewAction({ action: "click", sessionId: "abc", x: -12, y: 9000 }), {
    action: "click", sessionId: "abc", x: 0, y: 800,
  });
  assert.deepEqual(normalizeBrowserViewAction({ action: "key", sessionId: "abc", key: "Enter", modifiers: ["Control", "bogus", "Shift"] }), {
    action: "key", sessionId: "abc", key: "Enter", modifiers: ["Control", "Shift"],
  });
  assert.deepEqual(normalizeBrowserViewAction({ action: "switch_tab", sessionId: "abc", tabId: "tab-2" }), {
    action: "switch_tab", sessionId: "abc", tabId: "tab-2",
  });
  assert.throws(() => normalizeBrowserViewAction({ action: "navigate", sessionId: "abc" }), /url/i);
  assert.throws(() => normalizeBrowserViewAction({ action: "insert_text", sessionId: "abc", text: "" }), /1 to 4000/i);
});
