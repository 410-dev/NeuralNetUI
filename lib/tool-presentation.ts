import type { Locale, ToolEventStatus } from "./types";

export type ToolGroupState = "active" | "completed" | "error";

const TOOL_NAMES: Record<string, Record<Locale, string>> = {
  internet_search: { en: "Internet search", ko: "인터넷 검색" },
  visit_page: { en: "Page visit", ko: "페이지 방문" },
  get_current_time: { en: "Current time", ko: "현재 시간" },
  get_current_location: { en: "Current location", ko: "현재 위치" },
  ask_multiple_choice: { en: "Multiple choice", ko: "다중 선택" },
};

export function getToolDisplayName(name: string, locale: Locale) {
  const known = TOOL_NAMES[name]?.[locale];
  if (known) return known;
  const readable = name.replaceAll("_", " ").trim() || (locale === "ko" ? "알 수 없는" : "Unknown");
  return locale === "en" ? readable.charAt(0).toUpperCase() + readable.slice(1) : readable;
}

export function getToolStatusLabel(name: string, status: ToolEventStatus, locale: Locale) {
  const toolName = getToolDisplayName(name, locale);
  if (locale === "ko") {
    if (status === "calling" || status === "waiting") return `${toolName} 도구 사용 중`;
    if (status === "error") return `${toolName} 도구 사용 실패`;
    return `${toolName} 도구 사용함`;
  }
  if (status === "calling" || status === "waiting") return `Using ${toolName.toLowerCase()} tool`;
  if (status === "error") return `${toolName} tool failed`;
  return `Used ${toolName.toLowerCase()} tool`;
}

export function getToolGroupState(events: ReadonlyArray<{ status: ToolEventStatus }>): ToolGroupState {
  if (events.some((event) => event.status === "calling" || event.status === "waiting")) return "active";
  if (events.some((event) => event.status === "error")) return "error";
  return "completed";
}

export function getToolGroupLabel(state: ToolGroupState, locale: Locale) {
  if (locale === "ko") return state === "active" ? "도구 사용 중" : state === "error" ? "도구 사용 오류" : "도구 사용함";
  return state === "active" ? "Using tools" : state === "error" ? "Tool use finished with errors" : "Used tools";
}
