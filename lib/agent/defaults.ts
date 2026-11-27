/** The standing instructions a new agent starts with, in the person's language; "기본 값으로 되돌리기" restores them. */
export function defaultAgentInstructions(language: "ko" | "en" | undefined) {
  return language === "en" ? [
    "At every periodic check:",
    "1. Tell me about to-dos on the workboard that are overdue or due soon.",
    "2. Check events in the next 24 hours and any that overlap, and tell me about them.",
    "3. If mail or calendar tools are connected, summarize important new mail, and tell me when something in my mail conflicts with my calendar.",
    "4. If there is nothing worth my attention, do not send a message. Keep notes that recurring work needs on the workboard.",
  ].join("\n") : [
    "주기 점검 때마다 다음을 확인해 주세요.",
    "1. 워크보드의 할 일 중 기한이 지났거나 곧 다가오는 것이 있으면 알려 주세요.",
    "2. 앞으로 24시간 안의 일정과 서로 겹치는 일정을 확인해 알려 주세요.",
    "3. 메일·캘린더 도구가 연결되어 있으면 새로 온 중요한 메일을 요약하고, 메일 내용과 캘린더 일정이 충돌하면 알려 주세요.",
    "4. 알릴 것이 없으면 메시지를 보내지 마세요. 반복 작업에 필요한 기록은 워크보드에 남겨 두세요.",
  ].join("\n");
}

/**
 * The main chat's system prompt a new agent starts with; the person can rewrite it in the agent settings. It holds no
 * clock: the person's messages and subagent results carry their own time line, so the prompt stays the same from turn
 * to turn (a changing prompt makes the provider read the whole conversation again).
 */
export function defaultAgentMainPrompt(language: "ko" | "en" | undefined) {
  return [
    "# Personal agent",
    "You are the person's personal assistant in one long-running chat. They give you requests here; you also report here on your own.",
    `Reply in ${language === "en" ? "English" : "Korean"} unless the person writes otherwise.`,
    "- The system puts the time in front of each of the person's messages (\"Current time\" / \"현재 시각\") and of each subagent result (when it finished and returned). The person does not see or type these lines; use them to know the time now and when things happened.",
    "- Keep this chat short. Hand anything needing several tool calls, reading long material or waiting to spawn_subagent, then tell the person briefly what you started. Answer simple questions directly.",
    "- Requests for later or repeated work (reminders, watching an inbox, a calendar, a web page, a channel or a topic) become notify_wakeup schedules with complete instructions for the subagent that will run them. Confirm what you scheduled and when.",
    "- Keep the workboard current: to-dos, events from the person's schedule, and memories of durable facts and preferences. Check it before answering about plans or past requests.",
    "- User messages that begin with [Subagent result] or [Agent notice] come from the system, not the person. Summarize what matters for the person in a few lines; do not repeat raw output.",
    "- Never claim to have done something a tool did not confirm.",
  ].join("\n");
}

/** "2026-11-27 03:45:12 PM" in the given time zone (UTC when it is unknown or invalid), followed by the zone. */
export function agentClock(date: Date, timeZone: string | undefined) {
  const format = (zone: string) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }).formatToParts(date).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${parts.dayPeriod} (${zone})`;
  };
  try { return format(timeZone || "UTC"); } catch { return format("UTC"); }
}

/** The time line the system puts in front of a main-chat message, for the model only. */
export function agentClockLine(kind: "sent" | "returned", date: Date, settings: { timeZone?: string; language?: "ko" | "en" }) {
  const time = agentClock(date, settings.timeZone);
  if (settings.language === "en") return kind === "sent" ? `Current time: ${time}` : `Subagent finished and returned at: ${time}`;
  return kind === "sent" ? `현재 시각: ${time}` : `서브에이전트 종료 및 반환 시각: ${time}`;
}

/** Where the main agent's instructions go in the subagent task template. */
export const SUBAGENT_TASK_PLACEHOLDER = "{task}";

/**
 * The message a subagent starts from: the main agent's (or the schedule's) instructions in place of {task}, and the
 * rule that a task its tools cannot do ends as failed instead of being worked around. Editable in the agent settings.
 */
export function defaultSubagentTemplate(language: "ko" | "en" | undefined) {
  return language === "en" ? [
    "{task}",
    "",
    "---",
    "Before you start, check that the tools this task needs are in your tool list. A tool listed by name with a one-line summary is available: read its definition with get_tool_details before calling it. If a tool the instructions name or need is not in the list at all, or a required step cannot be done with the tools you have, do not switch to another method and do not guess: call report_failure saying what is missing, then stop.",
  ].join("\n") : [
    "{task}",
    "",
    "---",
    "시작하기 전에 이 작업에 필요한 도구가 도구 목록에 있는지 확인하세요. 이름과 한 줄 설명만 있는 도구도 쓸 수 있으며, 부르기 전에 get_tool_details로 정의를 받으세요. 지침에 나온 도구나 꼭 필요한 도구가 목록에 아예 없거나, 필요한 단계를 가진 도구로 할 수 없으면 다른 방법으로 대신하거나 추측하지 말고 report_failure로 무엇이 없는지 알린 뒤 멈추세요.",
  ].join("\n");
}

/** The template with the task put in; a template without {task} gets the task in front. */
export function applySubagentTemplate(template: string | undefined, task: string, language: "ko" | "en" | undefined) {
  const source = template?.trim() || defaultSubagentTemplate(language);
  return source.includes(SUBAGENT_TASK_PLACEHOLDER) ? source.split(SUBAGENT_TASK_PLACEHOLDER).join(task) : `${task}\n\n${source}`;
}
