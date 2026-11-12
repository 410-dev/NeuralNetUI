import assert from "node:assert/strict";
import test from "node:test";
import { createThinkingSplitter, DEFAULT_THINKING_TAGS, normalizeThinkingTags, splitThinking, type ThinkingPiece } from "./thinking-tags.ts";

const join = (pieces: ThinkingPiece[], kind: ThinkingPiece["kind"]) => pieces.filter(piece => piece.kind === kind).map(piece => piece.text).join("");

test("tags with no whitespace around them split the answer from the reasoning", () => {
  assert.deepEqual(splitThinking("<think>abcd</think>hello", "", DEFAULT_THINKING_TAGS), { reasoning: "abcd", content: "hello" });
});

test("a whole reply the server put into reasoning gives its answer back", () => {
  assert.deepEqual(splitThinking("", "<think>abcd</think>hello", DEFAULT_THINKING_TAGS), { reasoning: "abcd", content: "hello" });
  assert.deepEqual(splitThinking("", "abcd</think>\n\nhello", DEFAULT_THINKING_TAGS), { reasoning: "abcd", content: "hello" });
});

test("server-split reasoning without tags is left alone", () => {
  assert.deepEqual(splitThinking("hello", "abcd", DEFAULT_THINKING_TAGS), { reasoning: "abcd", content: "hello" });
});

test("channel-style tags and custom pairs are recognised", () => {
  assert.deepEqual(splitThinking("<|channel>thought\nplan<channel|>answer", "", DEFAULT_THINKING_TAGS), { reasoning: "plan", content: "answer" });
  const custom = [{ start: "[[R]]", end: "[[/R]]" }];
  assert.deepEqual(splitThinking("x[[R]]y[[/R]]z", "", custom), { reasoning: "y", content: "xz" });
  assert.deepEqual(splitThinking("<think>a</think>b", "", []), { reasoning: "", content: "<think>a</think>b" }, "no tags means no splitting");
});

test("a tag split across chunks is still found", () => {
  const splitter = createThinkingSplitter(DEFAULT_THINKING_TAGS);
  const pieces = ["<th", "ink>ab", "cd</th", "ink>hel", "lo"].flatMap(chunk => splitter.push("content", chunk)).concat(splitter.flush());
  assert.equal(join(pieces, "reasoning"), "abcd");
  assert.equal(join(pieces, "content"), "hello");
});

test("a held tail that never becomes a tag is released on flush", () => {
  const splitter = createThinkingSplitter(DEFAULT_THINKING_TAGS);
  const pieces = [...splitter.push("content", "a < b <th"), ...splitter.flush()];
  assert.equal(join(pieces, "content"), "a < b <th");
});

test("only the matching end tag closes a block opened in the content", () => {
  assert.deepEqual(splitThinking("<think>a<channel|>b</think>c", "", DEFAULT_THINKING_TAGS), { reasoning: "a<channel|>b", content: "c" });
});

test("stored tag lists keep complete distinct pairs", () => {
  assert.equal(normalizeThinkingTags(undefined), undefined);
  assert.deepEqual(normalizeThinkingTags([]), []);
  assert.deepEqual(normalizeThinkingTags([{ start: " <a> ", end: "</a>" }, { start: "<a>", end: "</a>" }, { start: "x", end: "" }, { start: "y", end: "y" }]), [{ start: "<a>", end: "</a>" }]);
});

test("cross matching lets any end tag close a block opened by any start tag", () => {
  assert.deepEqual(splitThinking("<think>a<channel|>b", "", DEFAULT_THINKING_TAGS), { reasoning: "a<channel|>b", content: "" });
  assert.deepEqual(splitThinking("<think>a<channel|>b", "", DEFAULT_THINKING_TAGS, { cross: true }), { reasoning: "a", content: "b" });
  assert.deepEqual(splitThinking("<|channel>thought\nplan</think>answer", "", DEFAULT_THINKING_TAGS, { cross: true }), { reasoning: "plan", content: "answer" });
});
