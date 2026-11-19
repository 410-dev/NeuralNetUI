import { functionLabel } from "./tools/catalog.ts";
import type { Locale, ToolEventStatus } from "./types";

export type ToolGroupState = "active" | "completed" | "error";

/** Tools that no longer ship, so calls saved in older chats keep a readable name. */
const RETIRED_TOOL_NAMES: Record<string, Record<Locale, string>> = {
  browser: { en: "Browser", ko: "브라우저" },
  host_computer: { en: "Host computer", ko: "호스트 컴퓨터" },
};

export function getToolDisplayName(name: string, locale: Locale) {
  const known = functionLabel(name, locale) ?? RETIRED_TOOL_NAMES[name]?.[locale];
  if (known) return known;
  const mcpName = name.match(/^mcp_[a-f0-9]{8}_(.+)$/i)?.[1];
  const readable = (mcpName ? `MCP ${mcpName}` : name).replaceAll("_", " ").trim() || (locale === "ko" ? "알 수 없는" : "Unknown");
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

type ToolSummaryEvent = { name: string; status: ToolEventStatus };

export function getToolGroupLabel(events: ReadonlyArray<ToolSummaryEvent>, locale: Locale) {
  const activeNames = [...new Set(events
    .filter((event) => event.status === "calling" || event.status === "waiting")
    .map((event) => getToolDisplayName(event.name, locale)))];
  if (activeNames.length) return locale === "ko"
    ? `도구 사용 중: ${activeNames.join(", ")}`
    : `Using tools: ${activeNames.join(", ")}`;

  const failed = events.filter((event) => event.status === "error").length;
  if (locale === "ko") return `${events.length}개의 도구 사용함${failed ? ` (${failed}개 실패)` : ""}`;
  const toolCount = `${events.length} ${events.length === 1 ? "tool" : "tools"}`;
  const failedCount = failed ? ` (${failed} failed)` : "";
  return `Used ${toolCount}${failedCount}`;
}

function toolCallMarker(name: string, locale: Locale) {
  return locale === "ko"
    ? `[${getToolDisplayName(name, locale)} 도구 호출함]`
    : `[Called ${getToolDisplayName(name, locale).toLowerCase()} tool]`;
}

/** Display-only markers for the tool calls made between two merged reasoning passages. */
export function formatToolCallMarkers(events: ReadonlyArray<{ name: string }>, locale: Locale) {
  return events.map((event) => toolCallMarker(event.name, locale)).join("\n");
}

export function formatReasoningForDisplay(
  reasoning: string,
  events: ReadonlyArray<{ name: string; reasoningOffset?: number }>,
  locale: Locale,
) {
  if (!events.length) return reasoning;
  const calls = events.map((event, index) => ({
    index,
    offset: Math.max(0, Math.min(reasoning.length, event.reasoningOffset ?? reasoning.length)),
    label: toolCallMarker(event.name, locale),
  })).sort((left, right) => left.offset - right.offset || left.index - right.index);

  let cursor = 0;
  let displayed = "";
  for (let callIndex = 0; callIndex < calls.length;) {
    const offset = calls[callIndex].offset;
    const labels: string[] = [];
    while (callIndex < calls.length && calls[callIndex].offset === offset) labels.push(calls[callIndex++].label);
    displayed += reasoning.slice(cursor, offset);
    if (displayed && !displayed.endsWith("\n")) displayed += "\n";
    displayed += labels.join("\n");
    if (offset < reasoning.length && reasoning[offset] !== "\n") displayed += "\n";
    cursor = offset;
  }
  return displayed + reasoning.slice(cursor);
}
