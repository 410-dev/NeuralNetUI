import assert from "node:assert/strict";
import test from "node:test";
import { contextOverflowDetails, contextThresholdReached, projectedInputTokens, DEFAULT_HARNESS_SETTINGS, estimateTokens, rollingMessages } from "./harness.ts";

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
  assert.equal(DEFAULT_HARNESS_SETTINGS.artifactAutoSaveToStorage,true);
});

test("the compaction decision never uses the smaller of estimate and measurement", () => {
  // A tokenizer charging more than the structural estimate must still trigger compaction.
  assert.equal(projectedInputTokens(1200, 3600), 3600);
  assert.equal(projectedInputTokens(4000, 1200), 4000);
  assert.equal(projectedInputTokens(500, undefined), 500);
  assert.equal(projectedInputTokens(500, 0), 500);
  assert.equal(projectedInputTokens(500, Number.NaN), 500);
  assert.equal(projectedInputTokens(4000, 3600, 3000), 4600);
  assert.equal(projectedInputTokens(2500, 3600, 3000), 3600);
  // 89% of a window crosses an 80% threshold once the measurement is taken into account.
  const window = 4000;
  assert.equal(contextThresholdReached(projectedInputTokens(1000, 3560), window, 80), true);
  assert.equal(contextThresholdReached(projectedInputTokens(1000, undefined), window, 80), false);
});

test("image estimates honor internal vision budgets and context overflow errors are normalized", () => {
  assert.equal(estimateTokens({ type: "image_url", image_url: { url: "data:image/jpeg;base64,x" }, _neural_context_tokens: 24000 }), 24000);
  assert.deepEqual(contextOverflowDetails(new Error('Engine protocol predict request returned 400: {"error":{"type":"exceed_context_size_error","n_prompt_tokens":186236,"n_ctx":128000}}')), { promptTokens: 186236, contextWindow: 128000 });
  assert.equal(contextOverflowDetails(new Error("connection refused")), undefined);
});

test("Drop Details keeps the conversation text and removes tool content and reasoning", async () => {
  const { dropDetails, dropDetailsBeforeLatestTools, VISUAL_TOOL_CONTENT_PREFIX } = await import("./harness.ts");
  const call = [{ id: "c1", type: "function", function: { name: "internet_search", arguments: "{}" } }];
  const messages = [
    { role: "system", content: "rules" },
    { role: "user", content: "find it" },
    { role: "assistant", content: "", reasoning_content: "thinking", tool_calls: call },
    { role: "tool", content: "{\"results\":[]}", tool_call_id: "c1" },
    { role: "user", content: [{ type: "text", text: `${VISUAL_TOOL_CONTENT_PREFIX}browser tool:` }] },
    { role: "assistant", content: "Here it is.", reasoning_content: "more thinking" },
    { role: "user", content: "thanks" },
  ];
  assert.deepEqual(dropDetails(messages, 6), [
    { role: "system", content: "rules" },
    { role: "user", content: "find it" },
    { role: "assistant", content: "Here it is." },
    { role: "user", content: "thanks" },
  ]);
  // Inside a reply the newest tool exchange stays, and texts left side by side are joined.
  const inReply = [
    { role: "user", content: "go" },
    { role: "assistant", content: "Step one.", tool_calls: call },
    { role: "tool", content: "a", tool_call_id: "c1" },
    { role: "assistant", content: "Step two.", tool_calls: [{ ...call[0], id: "c2" }] },
    { role: "tool", content: "b", tool_call_id: "c2" },
  ];
  assert.deepEqual(dropDetailsBeforeLatestTools(inReply), [
    { role: "user", content: "go" },
    { role: "assistant", content: "Step one.\n\nStep two.", tool_calls: [{ ...call[0], id: "c2" }] },
    { role: "tool", content: "b", tool_call_id: "c2" },
  ]);
});

test("token counts read short in transcript labels", async () => {
  const { formatTokenCount } = await import("./harness.ts");
  assert.deepEqual([999, 1000, 1250, 9_960, 50_400, 1_400_000].map(formatTokenCount), ["999", "1k", "1.3k", "10k", "50k", "1.4M"]);
});

test("compaction prompt goes after the conversation by default and honors {CHAT_CONTENT}", async () => {
  const { compactionMessages } = await import("./harness.ts");
  assert.deepEqual(compactionMessages("Summarize.", "CHAT"), [{ role: "user", content: "CHAT\n\nSummarize." }]);
  assert.deepEqual(compactionMessages("Summarize.", "CHAT", "before"), [{ role: "system", content: "Summarize." }, { role: "user", content: "CHAT" }]);
  assert.deepEqual(compactionMessages("A {CHAT_CONTENT} B $&", "x$'y", "before"), [{ role: "user", content: "A x$'y B $&" }]);
});
