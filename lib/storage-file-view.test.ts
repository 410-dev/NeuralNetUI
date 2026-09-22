import assert from "node:assert/strict";
import test from "node:test";
import { isEditableStorageFile, storageFileLanguage, storageFileViewKind } from "./storage-file-view.ts";

test("classifies renderable storage files by MIME type or extension", () => {
  assert.equal(storageFileViewKind("report.html", "application/octet-stream"), "html");
  assert.equal(storageFileViewKind("data", "application/ld+json"), "json");
  assert.equal(storageFileViewKind("table.csv", "text/plain"), "csv");
  assert.equal(storageFileViewKind("feed.xml", "application/xml; charset=utf-8"), "xml");
  assert.equal(storageFileViewKind("notes.md", "text/markdown"), "markdown");
});

test("separates editable text from media and binary files", () => {
  assert.equal(storageFileViewKind("photo.png", "image/png"), "image");
  assert.equal(storageFileViewKind("manual.pdf", "application/pdf"), "pdf");
  assert.equal(storageFileViewKind("script.ts", "application/octet-stream"), "text");
  assert.equal(storageFileLanguage("script.ts", "application/octet-stream"), "ts");
  assert.equal(isEditableStorageFile("archive.zip", "application/zip"), false);
  assert.equal(isEditableStorageFile("settings.yaml", "application/yaml"), true);
});
