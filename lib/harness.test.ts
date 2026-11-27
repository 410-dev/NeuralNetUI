import assert from "node:assert/strict";
import test from "node:test";
import { contextOverflowDetails, contextThresholdReached, measuredContextInput, projectedInputTokens, DEFAULT_HARNESS_SETTINGS, estimateTokens, rollingMessages } from "./harness.ts";

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

test("executable headers are matched against the host", async () => {
  const { executableTarget, targetMatchesHost } = await import("./managed-binaries.ts");
  const elf = Buffer.alloc(64); elf.writeUInt32BE(0x7f454c46, 0); elf[4] = 2; elf[5] = 1; elf.writeUInt16LE(0x3e, 18);
  assert.deepEqual(executableTarget(elf), { os: "linux", archs: ["x64"] });
  assert.equal(targetMatchesHost(executableTarget(elf), { os: "linux", arch: "x64" }), true);
  assert.equal(targetMatchesHost(executableTarget(elf), { os: "linux", arch: "arm64" }), false);
  elf.writeUInt16LE(0xb7, 18);
  assert.deepEqual(executableTarget(elf), { os: "linux", archs: ["arm64"] });
  const macho = Buffer.alloc(32); macho.writeUInt32LE(0xfeedfacf, 0); macho.writeInt32LE(0x0100000c, 4);
  assert.deepEqual(executableTarget(macho), { os: "darwin", archs: ["arm64"] });
  const pe = Buffer.alloc(0x100); pe.write("MZ", 0, "latin1"); pe.writeUInt32LE(0x80, 0x3c); pe.write("PE\0\0", 0x80, "latin1"); pe.writeUInt16LE(0x8664, 0x84);
  assert.deepEqual(executableTarget(pe), { os: "win32", archs: ["x64"] });
  assert.equal(executableTarget(Buffer.from("#!/bin/sh\necho hi\n")), undefined);
});

test("YouTube links, subtitle tracks and paging", async () => {
  const yt = await import("./youtube-subtitles.ts");
  assert.equal(yt.videoUrl("https://youtu.be/dQw4w9WgXcQ?t=3").id, "dQw4w9WgXcQ");
  assert.equal(yt.videoUrl("youtube.com/shorts/dQw4w9WgXcQ").id, "dQw4w9WgXcQ");
  assert.throws(() => yt.videoUrl("https://example.com/watch?v=dQw4w9WgXcQ"));
  assert.throws(() => yt.videoUrl("https://www.youtube.com/playlist?list=PL123"));
  const info = { language: "ko", subtitles: { en: [{ ext: "vtt", url: "u1" }] }, automatic_captions: { "ko-orig": [{ ext: "json3", url: "u2" }], en: [{ ext: "json3", url: "u3" }] } };
  assert.equal(yt.chooseTrack(info, "", ["ko", "en"]).language, "en");
  assert.deepEqual({ ...yt.chooseTrack({ ...info, subtitles: {} }, "", ["ko"]), formats: undefined }, { language: "ko", kind: "auto", translated: false, formats: undefined });
  const cues = yt.parseSubtitles(JSON.stringify({ events: [{ tStartMs: 0, segs: [{ utf8: "Hello &amp; welcome" }] }, { tStartMs: 1000, segs: [{ utf8: "world" }] }, { tStartMs: 9000, segs: [{ utf8: "Later" }] }] }), "json3");
  assert.equal(yt.transcriptText(cues, true), "[0:00] Hello & welcome world\n\n[0:09] Later");
  const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nOne\n\n00:00:02.000 --> 00:00:03.000\nOne\nTwo\n";
  assert.deepEqual(yt.parseSubtitles(vtt, "vtt").map(cue => cue[1]), ["One", "Two"]);
  const first = yt.page("alpha beta gamma delta", 0, 12);
  assert.equal(first.text, "alpha beta");
  assert.equal(yt.page("alpha beta gamma delta", first.next!, 100).text, " gamma delta");
});

test("the context size LMF reports wins over its summed prompt tokens; an implausible LMF sum is not trusted", () => {
  // codex called its model twice on a 229k conversation: prompt_tokens 458k, context 229k.
  assert.equal(measuredContextInput({ inputTokens: 458_634, contextInputTokens: 229_500 }, 200_000, true), 229_500);
  assert.equal(measuredContextInput({ inputTokens: 458_634 }, 200_000, true), undefined);
  assert.equal(measuredContextInput({ inputTokens: 230_000 }, 200_000, true), 230_000);
  assert.equal(measuredContextInput({ inputTokens: 458_634 }, 200_000, false), 458_634);
  assert.equal(measuredContextInput({}, 200_000, true), undefined);
});
