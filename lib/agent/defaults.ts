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
