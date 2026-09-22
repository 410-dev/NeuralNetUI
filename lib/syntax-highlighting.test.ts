import assert from "node:assert/strict";
import test from "node:test";
import { highlightCode, normalizeCodeLanguage } from "./syntax-highlighting.ts";

test("syntax highlighting normalizes common fenced-code aliases", () => {
  assert.equal(normalizeCodeLanguage("ts"), "typescript");
  assert.equal(normalizeCodeLanguage("sh"), "bash");
  assert.equal(normalizeCodeLanguage("md"), "markdown");
  assert.equal(normalizeCodeLanguage("unknown-language"), undefined);
});

test("syntax highlighting emits escaped, tokenized markup", () => {
  const result = highlightCode('const answer: number = 42 < 50;', "ts");
  assert.equal(result.language, "typescript");
  assert.match(result.html, /hljs-keyword/);
  assert.match(result.html, /&lt;/);
  assert.doesNotMatch(result.html, /<script/i);
});

test("syntax highlighting auto-detects unlabeled code and safely escapes plain text", () => {
  assert.ok(highlightCode("SELECT id FROM users WHERE active = 1;").language);
  assert.equal(highlightCode("<script>alert(1)</script>", "text").html, "&lt;script&gt;alert(1)&lt;/script&gt;");
});
