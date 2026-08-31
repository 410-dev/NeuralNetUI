import assert from "node:assert/strict";
import test from "node:test";
import { copyTextWithAdapter } from "./client-clipboard.ts";

test("secure clipboard writes without invoking the fallback", async () => {
  const calls: string[] = [];
  const copied = await copyTextWithAdapter({
    isSecureContext: true,
    writeText: async (text) => { calls.push(`clipboard:${text}`); },
    fallbackCopy: (text) => { calls.push(`fallback:${text}`); return true; },
  }, "message");
  assert.equal(copied, true);
  assert.deepEqual(calls, ["clipboard:message"]);
});

test("insecure contexts use the synchronous fallback directly", async () => {
  const calls: string[] = [];
  const copied = await copyTextWithAdapter({
    isSecureContext: false,
    writeText: async (text) => { calls.push(`clipboard:${text}`); },
    fallbackCopy: (text) => { calls.push(`fallback:${text}`); return true; },
  }, "mobile message");
  assert.equal(copied, true);
  assert.deepEqual(calls, ["fallback:mobile message"]);
});

test("clipboard permission failures fall back to selection copying", async () => {
  const copied = await copyTextWithAdapter({
    isSecureContext: true,
    writeText: async () => { throw new Error("denied"); },
    fallbackCopy: () => true,
  }, "message");
  assert.equal(copied, true);
});
