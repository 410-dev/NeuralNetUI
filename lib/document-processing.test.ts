import assert from "node:assert/strict";
import test from "node:test";
import { assertUploadSignature, classifyDocument, decodeTextDocument, isSupportedUploadMimeType } from "./document-processing.ts";

test("classifies structured text, PDFs, images, archives, and unsupported binaries", () => {
  assert.equal(classifyDocument("application/json; charset=utf-8", "result"), "text");
  assert.equal(classifyDocument("application/octet-stream", "report.PDF"), "pdf");
  assert.equal(classifyDocument("image/png", "image.png"), "image");
  assert.equal(classifyDocument("application/zip", "bundle.zip"), "archive");
  assert.equal(classifyDocument("application/octet-stream", "program.exe"), "binary");
});

test("accepts safe raster images and PDFs as uploads", () => {
  assert.equal(isSupportedUploadMimeType("application/pdf"), true);
  assert.equal(isSupportedUploadMimeType("image/jpeg"), true);
  assert.equal(isSupportedUploadMimeType("image/svg+xml"), false);
  assert.equal(isSupportedUploadMimeType("application/zip"), false);
});

test("decodes and formats JSON while preserving truncation metadata", () => {
  const result = decodeTextDocument(Buffer.from('{"name":"NeuralNetUI","items":[1,2]}'), "application/json; charset=utf-8", 28);
  assert.match(result.text, /"name": "NeuralNetUI"/);
  assert.equal(result.truncated, true);
});

test("rejects binary data disguised as text", () => {
  assert.throws(() => decodeTextDocument(Buffer.from([0, 1, 2, 3, 0, 255]), "text/plain", 100), /binary/i);
});

test("rejects upload MIME types that do not match file signatures", () => {
  assert.doesNotThrow(() => assertUploadSignature(Buffer.from("%PDF-1.7\n"), "application/pdf"));
  assert.throws(() => assertUploadSignature(Buffer.from("<script>alert(1)</script>"), "image/jpeg"), /signature/i);
});
