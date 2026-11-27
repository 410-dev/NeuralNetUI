import assert from "node:assert/strict";
import test from "node:test";
import { htmlToText, MAX_MODEL_RESULT_CHARS, resultBudget, slimJson, slimText } from "./mcp-result.ts";

test("HTML becomes readable text without styles, scripts or tags", () => {
  const html = `<html><head><style>p{color:red}</style></head><body><!-- x --><p>Hello&nbsp;<b>there</b> &amp; you</p><script>alert(1)</script><div>Line&#33;<br>next &#x2603;</div><a href="https://example.com/a">Open</a></body></html>`;
  assert.equal(htmlToText(html), "Hello there & you\nLine!\nnext ☃\nOpen (https://example.com/a)");
});

test("a mail's HTML body goes when it has plain text, and becomes text when it has none", () => {
  const thread = { id: "t", messages: [
    { id: "a", plaintextBody: "Hi", htmlBody: "<p>Hi</p>".repeat(500) },
    { id: "b", plaintextBody: "", htmlBody: "<p>Only <i>html</i></p>" },
  ] };
  assert.deepEqual(slimJson(thread), { id: "t", messages: [
    { id: "a", plaintextBody: "Hi" },
    { id: "b", plaintextBody: "", htmlBodyAsText: "Only html" },
  ] });
});

test("encoded blobs are replaced by a note, ordinary long text is kept", () => {
  const blob = "QUJD".repeat(1000);
  const prose = "word ".repeat(1000);
  assert.deepEqual(slimJson({ data: blob, url: `data:image/png;base64,${blob}`, prose }), {
    data: "[encoded data, 4000 characters omitted]", url: "[image/png;base64 data, 4022 characters omitted]", prose });
});

test("JSON text is re-serialized compactly; other text stays", () => {
  assert.equal(slimText('{\n  "a": "\\u003cb\\u003e",\n  "n": [1, 2]\n}'), '{"a":"<b>","n":[1,2]}');
  assert.equal(slimText("plain {text}"), "plain {text}");
  assert.equal(slimText("{not json"), "{not json");
});

test("one call's parts share the character budget", () => {
  const take = resultBudget(10);
  assert.equal(take("12345"), "12345");
  const cut = take("abcdefghij");
  assert.ok(cut.startsWith("abcde\n[Result truncated: showing 5 of 10 characters."));
  assert.ok(take("more").startsWith("\n[Result truncated: showing 0 of 4"));
  assert.ok(MAX_MODEL_RESULT_CHARS >= 20_000);
});
