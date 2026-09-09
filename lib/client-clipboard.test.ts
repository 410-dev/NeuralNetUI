import assert from "node:assert/strict";
import test from "node:test";
import { copyTextWithAdapter, clipboardImages } from "./client-clipboard.ts";

test("text and rich text paste remain native, including mixed text/image clipboard data", () => {
  const image = new File(["image"], "image.png", { type: "image/png" });
  assert.deepEqual(clipboardImages({ getData: () => "hello\n여행자", files: [image] }), []);
  assert.deepEqual(clipboardImages({ getData: () => "", files: [] }), []);
});

test("image-only paste accepts images and excludes non-image files", () => {
  const image = new File(["image"], "image.png", { type: "image/png" });
  const pdf = new File(["pdf"], "file.pdf", { type: "application/pdf" });
  assert.deepEqual(clipboardImages({ getData: () => "", files: [image, pdf] }), [image]);
});

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
