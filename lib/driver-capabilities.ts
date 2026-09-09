import type { ConnectionDriver, Locale } from "./types.ts";

export type CapabilityState = "yes" | "partial" | "no";
export type CapabilityRow = { id: CapabilityId; label: string; state: CapabilityState; detail?: string };

const CAPABILITY_IDS = ["discovery", "management", "progress", "effort", "reasoningHistory"] as const;
export type CapabilityId = (typeof CAPABILITY_IDS)[number];

const LABELS: Record<CapabilityId, [string, string]> = {
  discovery: ["Model discovery", "모델 목록 자동 감지"],
  management: ["Load, unload and residency", "모델 로드·언로드·상주 관리"],
  progress: ["Load and prompt progress", "로드·프롬프트 진행률"],
  effort: ["Named reasoning levels", "추론 강도 단계 전달"],
  reasoningHistory: ["Prior reasoning history", "이전 생각 기록 전송"],
};

const STATE_WORDS: Record<CapabilityState, [string, string]> = {
  yes: ["Supported", "지원"],
  partial: ["Limited", "제한적"],
  no: ["Not supported", "미지원"],
};

const DETAILS: Partial<Record<CapabilityId, Partial<Record<ConnectionDriver, [string, string]>>>> = {
  discovery: {
    openai: ["Standard model list, enriched when the host also exposes LM Studio metadata", "표준 모델 목록. 같은 서버가 LM Studio 정보를 제공하면 함께 사용합니다"],
    lmstudio: ["Native inventory with reasoning capabilities and loaded instances", "추론 capability와 로드된 인스턴스까지 포함한 네이티브 목록"],
  },
  management: {
    openai: ["Probes LM Studio management, otherwise falls back to /api/inference", "LM Studio 관리 API를 먼저 시도하고, 없으면 /api/inference로 대체합니다"],
    lmstudio: ["Native load and unload endpoints", "네이티브 로드·언로드 엔드포인트"],
  },
  progress: {
    openai: ["Only on hosts verified as LM Studio, and only while the experimental switch is on", "LM Studio로 확인된 서버에서만, 실험적 기능 스위치를 켠 경우에만 표시됩니다"],
    lmstudio: ["Reported for plain requests; a named effort level or prior reasoning falls back to no progress", "일반 요청에서 표시됩니다. 추론 강도 단계나 이전 생각 기록이 있으면 진행률 없이 진행합니다"],
  },
};

export const capabilityLabel = (id: CapabilityId, locale: Locale) => LABELS[id][locale === "ko" ? 1 : 0];
export const capabilityStateWord = (state: CapabilityState, locale: Locale) => STATE_WORDS[state][locale === "ko" ? 1 : 0];

const STATES: Record<ConnectionDriver, Record<CapabilityId, CapabilityState>> = {
  openai: { discovery: "yes", management: "partial", progress: "no", effort: "yes", reasoningHistory: "yes" },
  lmstudio: { discovery: "yes", management: "yes", progress: "partial", effort: "yes", reasoningHistory: "yes" },
};

/**
 * What a driver can and cannot do, for the picker that chooses it. Progress for OpenAI-compatible
 * connections depends on the experimental switch, so that answer is computed rather than fixed.
 */
export function driverCapabilities(driver: ConnectionDriver, locale: Locale, options: { openAIProgress?: boolean } = {}): CapabilityRow[] {
  return CAPABILITY_IDS.map((id) => {
    let state = STATES[driver][id];
    if (id === "progress" && driver === "openai" && options.openAIProgress) state = "partial";
    return { id, label: capabilityLabel(id, locale), state, detail: DETAILS[id]?.[driver]?.[locale === "ko" ? 1 : 0] };
  });
}

/** One-line rendering of the same table, for assistive technology that cannot hover. */
export function capabilitySummary(rows: CapabilityRow[], locale: Locale) {
  return rows.map((row) => `${row.label}: ${capabilityStateWord(row.state, locale)}`).join(locale === "ko" ? ", " : ", ");
}
