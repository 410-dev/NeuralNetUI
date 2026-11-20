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
    google: ["Gemini models from the OpenAI-compatible model list (embedding and media models are skipped)", "OpenAI 호환 목록에서 Gemini 모델을 감지합니다 (임베딩·미디어 모델 제외)"],
    anthropic: ["Claude models with names and context windows from the Models API", "Models API에서 Claude 모델의 이름과 컨텍스트 길이까지 감지합니다"],
  },
  management: {
    google: ["Hosted service; there is nothing to load or unload", "호스팅 서비스라 로드·언로드할 대상이 없습니다"],
    anthropic: ["Hosted service; there is nothing to load or unload", "호스팅 서비스라 로드·언로드할 대상이 없습니다"],
    openai: ["Probes LM Studio management, otherwise falls back to /api/inference", "LM Studio 관리 API를 먼저 시도하고, 없으면 /api/inference로 대체합니다"],
    lmstudio: ["Native load and unload endpoints", "네이티브 로드·언로드 엔드포인트"],
  },
  progress: {
    lmstudio: ["SDK percentages for supported requests; other requests can show polled model-level prompt processing without a percentage", "지원되는 요청은 SDK 퍼센트를 표시합니다. 추론 강도 단계나 이전 생각 기록으로 폴백해도 모델 상태 조회가 가능하면 퍼센트 없이 프롬프트 처리 상태를 표시합니다"],
  },
  effort: {
    google: ["Sent as reasoning_effort (none, low, medium, high) to Gemini 2.5 and later", "Gemini 2.5 이상에 reasoning_effort(none·low·medium·high)로 전달합니다"],
    anthropic: ["Sent as output_config.effort with adaptive thinking; Temperature and other sampling values are not sent because current Claude models reject them", "적응형 사고와 함께 output_config.effort로 전달합니다. 최신 Claude 모델은 Temperature 등 샘플링 값을 받지 않으므로 전송하지 않습니다"],
  },
  reasoningHistory: {
    google: ["Earlier reasoning text is not accepted by the Gemini compatibility endpoint", "Gemini 호환 엔드포인트는 이전 생각 기록을 받지 않습니다"],
    anthropic: ["Earlier thinking is not replayed; Claude reasons afresh each turn", "이전 생각은 다시 보내지 않으며, Claude가 매 턴 새로 추론합니다"],
  },
};

export const capabilityLabel = (id: CapabilityId, locale: Locale) => LABELS[id][locale === "ko" ? 1 : 0];
export const capabilityStateWord = (state: CapabilityState, locale: Locale) => STATE_WORDS[state][locale === "ko" ? 1 : 0];

const STATES: Record<ConnectionDriver, Record<CapabilityId, CapabilityState>> = {
  openai: { discovery: "yes", management: "partial", progress: "no", effort: "yes", reasoningHistory: "yes" },
  lmstudio: { discovery: "yes", management: "yes", progress: "partial", effort: "yes", reasoningHistory: "yes" },
  google: { discovery: "yes", management: "no", progress: "no", effort: "yes", reasoningHistory: "no" },
  anthropic: { discovery: "yes", management: "no", progress: "no", effort: "yes", reasoningHistory: "no" },
};

/** What a driver can and cannot do, for the picker that chooses it. */
export function driverCapabilities(driver: ConnectionDriver, locale: Locale): CapabilityRow[] {
  return CAPABILITY_IDS.map((id) => {
    const state = STATES[driver][id];
    return { id, label: capabilityLabel(id, locale), state, detail: DETAILS[id]?.[driver]?.[locale === "ko" ? 1 : 0] };
  });
}

/** One-line rendering of the same table, for assistive technology that cannot hover. */
export function capabilitySummary(rows: CapabilityRow[], locale: Locale) {
  return rows.map((row) => `${row.label}: ${capabilityStateWord(row.state, locale)}`).join(locale === "ko" ? ", " : ", ");
}
