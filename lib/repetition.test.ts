import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_REPETITION_SETTINGS as rules, detectTextRepetition, detectToolCallRepetition, normalizeRepetitionSettings, toolArgumentText } from "./repetition.ts";

const words = (word: string, count: number) => Array(count).fill(word).join(" ");

test("word loops trigger at the threshold, not below it", () => {
  assert.equal(detectTextRepetition(`Sure: ${words("apple", 19)}`, "content", rules), undefined);
  const found = detectTextRepetition(`Sure: ${words("apple", 20)}`, "content", rules);
  assert.equal(found?.kind, "word"); assert.equal(found?.count, 20); assert.equal(found?.segment, "content");
  assert.equal(detectTextRepetition(words("Apple,", 25), "reasoning", rules)?.kind, "word");
});

test("word repetition must be consecutive", () => {
  const spread = Array.from({ length: 40 }, (_, index) => index % 2 ? "apple" : `word${index}`).join(" ");
  assert.equal(detectTextRepetition(spread, "content", rules), undefined);
});

test("sentence loops trigger after five consecutive copies", () => {
  const sentence = "I will now check the file again.";
  assert.equal(detectTextRepetition(`Start. ${Array(4).fill(sentence).join(" ")}`, "reasoning", rules), undefined);
  const found = detectTextRepetition(`Start. ${Array(5).fill(sentence).join(" ")}`, "reasoning", rules);
  assert.equal(found?.kind, "sentence"); assert.equal(found?.count, 5);
});

test("paragraph loops report the paragraph rather than its sentences", () => {
  const paragraph = "The answer depends on the configuration. Please check the settings.";
  const found = detectTextRepetition(Array(5).fill(paragraph).join("\n\n"), "content", rules);
  assert.equal(found?.kind, "paragraph"); assert.equal(found?.count, 5);
  assert.equal(detectTextRepetition(Array(4).fill("One paragraph that has enough text in it").join("\n\n"), "content", { ...rules, sentence: { enabled: false, threshold: 5 } }), undefined);
});

test("a group of paragraphs repeated twice is a group loop", () => {
  const group = "## Step one\n\nOpen the configuration file and read it.\n\nThen restart the service to apply it.";
  const found = detectTextRepetition(`Intro text here.\n\n${group}\n\n${group}`, "content", rules);
  assert.equal(found?.kind, "paragraphGroup"); assert.equal(found?.count, 2);
});

test("ordinary prose, code and short repeated lines do not trigger", () => {
  const prose = "NeuralNetUI streams responses. It stores chats in SQLite.\n\nAdministrators manage models and plans.\n\nUsers attach files and pick reasoning templates.";
  assert.equal(detectTextRepetition(prose, "content", rules), undefined);
  const code = "```html\n" + Array(8).fill("</div>").join("\n") + "\n```";
  assert.equal(detectTextRepetition(code, "content", rules), undefined);
});

test("disabled kinds are skipped", () => {
  const off = normalizeRepetitionSettings({ word: { enabled: false, threshold: 20 } });
  assert.equal(detectTextRepetition(words("apple", 30), "content", off), undefined);
});

test("settings fall back to defaults when missing or out of range", () => {
  assert.deepEqual(normalizeRepetitionSettings(undefined), rules);
  assert.equal(normalizeRepetitionSettings({ word: { enabled: true, threshold: 1 } }).word.threshold, 20);
  assert.equal(normalizeRepetitionSettings({ sentence: { enabled: false, threshold: 7 } }).sentence.threshold, 7);
});

test("identical tool calls in a row and repeated call sequences are loops", () => {
  const call = { name: "web_search", arguments: { query: "weather seoul" } };
  assert.equal(detectToolCallRepetition(Array(4).fill(call), rules), undefined);
  assert.equal(detectToolCallRepetition(Array(5).fill(call), rules)?.kind, "paragraph");
  const read = { name: "visit_page", arguments: { url: "https://example.com" } };
  assert.equal(detectToolCallRepetition([call, read, call, read], rules)?.kind, "paragraphGroup");
  assert.equal(detectToolCallRepetition([call, read, { name: "web_search", arguments: { query: "other" } }], rules), undefined);
});

test("escaped tool argument text is readable for detection", () => {
  assert.equal(toolArgumentText('{"text":"a\\n\\nb \\"q\\""}'), '{"text":"a\n\nb "q""}');
});
