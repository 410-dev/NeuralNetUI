import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_HARNESS_SETTINGS, estimateTokens, rollingMessages } from "./harness.ts";

test("resume substitution is literal and non-recursive; threshold includes equality", async () => {
  const { resumePrompt, contextThresholdReached } = await import("./harness.ts");
  assert.equal(resumePrompt("%COMPRESSED% / %USER_PROMPT%", "$& %USER_PROMPT%", "%COMPRESSED%"), "$& %USER_PROMPT% / %COMPRESSED%");
  assert.equal(contextThresholdReached(800, 1000, 80), true);
  assert.equal(contextThresholdReached(799, 1000, 80), false);
  assert.equal(contextThresholdReached(900, undefined, 80), false);
});

test("rolling removes complete turns and preserves system, latest prompt and source history", () => {
  const messages = [{role:"system",content:"rules"}, {role:"user",content:"old".repeat(1000)}, {role:"assistant",content:"",tool_calls:[{id:"a"}]}, {role:"tool",content:"result"}, {role:"user",content:"latest"}];
  assert.deepEqual(rollingMessages(messages,100), [messages[0],messages[4]]);
  assert.equal(messages.length,5);
});
test("an oversized latest turn fails explicitly without dropping its prompt", () => {
  assert.throws(() => rollingMessages([{role:"user",content:"x".repeat(1000)}],20), /latest turn/);
});
test("multilingual estimate and conservative defaults", () => {
  assert.ok(estimateTokens("한글") > estimateTokens("ab"));
  assert.equal(DEFAULT_HARNESS_SETTINGS.maxOutputTokens,0);
  assert.equal(DEFAULT_HARNESS_SETTINGS.titleEnabled,false);
  assert.equal(DEFAULT_HARNESS_SETTINGS.titleEffort,"off");
});
