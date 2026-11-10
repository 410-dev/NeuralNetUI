import assert from "node:assert/strict";
import test from "node:test";
import { isTextAttachmentType, textAttachmentMimeType } from "./text-attachments.ts";

test("plain-text attachments are recognised by extension when the browser sends no type", () => {
  assert.equal(textAttachmentMimeType("notes.md", ""), "text/markdown");
  assert.equal(textAttachmentMimeType("README.TXT", "application/octet-stream"), "text/plain");
  assert.equal(textAttachmentMimeType("data.json", ""), "application/json");
  assert.equal(textAttachmentMimeType("unknown.bin", "text/plain; charset=utf-8"), "text/plain");
});

test("binary and document types are not text attachments", () => {
  assert.equal(textAttachmentMimeType("photo.png", "image/png"), undefined);
  assert.equal(textAttachmentMimeType("archive.zip", "application/zip"), undefined);
  assert.equal(isTextAttachmentType("application/pdf"), false);
  assert.equal(isTextAttachmentType("text/csv"), true);
  assert.equal(isTextAttachmentType("application/yaml"), true);
});
