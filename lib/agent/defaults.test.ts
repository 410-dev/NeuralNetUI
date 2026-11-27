import assert from "node:assert/strict";
import test from "node:test";
import { agentClock, agentClockLine, defaultAgentMainPrompt } from "./defaults.ts";

test("the agent clock reads YYYY-MM-DD hh:mm:ss AM/PM in the agent's time zone", () => {
  const at = new Date("2026-11-27T06:45:12Z");
  assert.equal(agentClock(at, "Asia/Seoul"), "2026-11-27 03:45:12 PM (Asia/Seoul)");
  assert.equal(agentClock(at, "Not/AZone"), "2026-11-27 06:45:12 AM (UTC)");
  assert.equal(agentClockLine("sent", at, { timeZone: "Asia/Seoul", language: "ko" }), "현재 시각: 2026-11-27 03:45:12 PM (Asia/Seoul)");
  assert.equal(agentClockLine("returned", at, { timeZone: "Asia/Seoul", language: "ko" }), "서브에이전트 종료 및 반환 시각: 2026-11-27 03:45:12 PM (Asia/Seoul)");
  assert.equal(agentClockLine("sent", at, { language: "en" }), "Current time: 2026-11-27 06:45:12 AM (UTC)");
});

test("the default main prompt holds no clock, so it is the same every turn", () => {
  const prompt = defaultAgentMainPrompt("ko");
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(prompt) && prompt.includes("Reply in Korean"));
  assert.equal(prompt, defaultAgentMainPrompt("ko"));
});

test("the subagent template puts the task in place of {task}, in front when the template has none", async () => {
  const { applySubagentTemplate, defaultSubagentTemplate } = await import("./defaults.ts");
  assert.equal(applySubagentTemplate("Do this:\n{task}\nThen stop.", "check mail", "ko"), "Do this:\ncheck mail\nThen stop.");
  assert.equal(applySubagentTemplate("Rules only", "check mail", "ko"), "check mail\n\nRules only");
  const filled = applySubagentTemplate(undefined, "check mail", "ko");
  assert.ok(filled.startsWith("check mail") && filled.includes("report_failure"));
  assert.ok(defaultSubagentTemplate("en").includes("{task}") && defaultSubagentTemplate("en").includes("report_failure"));
});
