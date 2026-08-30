import assert from "node:assert/strict";
import test from "node:test";

import { normalizeBrowserAction, privateBrowserAddress } from "./browser-tool.ts";

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
  assert.throws(() => normalizeBrowserAction({ action: "type", session_id: "abc", target: "e1" }), /text/i);
  assert.throws(() => normalizeBrowserAction({ action: "unknown" }), /action/i);
});
