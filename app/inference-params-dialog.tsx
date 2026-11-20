"use client";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, RotateCcw, Trash2, X } from "lucide-react";
import { SelectMenu } from "@/app/select-menu";
import { useModalTransition } from "@/lib/use-modal-focus";
import { normalizeSamplingParams, SAMPLING_KEYS, SAMPLING_LIMITS, type SamplingKey, type SamplingParams } from "@/lib/sampling-params";
import { DEFAULT_THINKING_TAGS, type ThinkingTag } from "@/lib/thinking-tags";
import type { ModelConfig, ReasoningPreset } from "@/lib/types";

type Strings = Partial<Record<SamplingKey, string>>;
type Layer = { base: Strings; presets: Record<string, Strings> };
type Personal = { base?: SamplingParams; presets?: Record<string, SamplingParams> };
const MODEL_TARGET = "__model__";

export type InferenceParamsResult = {
  samplingParams?: SamplingParams;
  presetSamplingParams?: Record<string, SamplingParams | undefined>;
  personal?: Personal;
  thinkingTags?: ThinkingTag[];
  thinkingTagsCross?: boolean;
  userEditable?: boolean;
};

const toStrings = (params?: SamplingParams): Strings => Object.fromEntries(SAMPLING_KEYS.filter(key => params?.[key] !== undefined).map(key => [key, String(params![key])]));
const blank = (value?: string) => value === undefined || value.trim() === "";
function fieldError(key: SamplingKey, value?: string) {
  if (blank(value)) return false;
  const number = Number(value); const { min, max, integer } = SAMPLING_LIMITS[key];
  return !Number.isFinite(number) || number < min || number > max || Boolean(integer && !Number.isInteger(number));
}
const toParams = (strings: Strings) => normalizeSamplingParams(Object.fromEntries(Object.entries(strings).filter(([, value]) => !blank(value))));
const pick = (...values: Array<number | undefined>) => values.find(value => value !== undefined);

/**
 * Edits the inference parameters a model's requests carry: Temperature, Top K, repeat and presence penalties, Top P and Min P.
 * Administrators set the workspace values for the model and each reasoning template, and decide whether accounts may
 * keep their own; accounts then set personal values that are never shared. A blank field always means "inherit",
 * ending at the model server's own default. Administrators also edit the served model's thinking tags here.
 */
export function InferenceParamsDialog({ ko, model, served, presets, privileged, accountId, userEditable, personal, canEditThinkingTags, onApply, onClose }: {
  ko: boolean; model: ModelConfig; served?: ModelConfig; presets: ReasoningPreset[]; privileged: boolean; accountId?: string;
  userEditable: boolean; personal?: Personal; canEditThinkingTags: boolean;
  onApply: (result: InferenceParamsResult) => void; onClose: () => void;
}) {
  const { ref, close, closing } = useModalTransition(onClose);
  const [allowUsers, setAllowUsers] = useState(userEditable);
  const [scope, setScope] = useState<"global" | "personal">(privileged ? "global" : "personal");
  const [target, setTarget] = useState(MODEL_TARGET);
  const [global, setGlobal] = useState<Layer>(() => ({ base: toStrings(model.samplingParams), presets: Object.fromEntries(presets.map(preset => [preset.id, toStrings(preset.samplingParams)])) }));
  const [own, setOwn] = useState<Layer>(() => ({ base: toStrings(personal?.base), presets: Object.fromEntries(Object.entries(personal?.presets || {}).map(([id, params]) => [id, toStrings(params)])) }));
  const [tags, setTags] = useState<ThinkingTag[]>(() => (model.thinkingTags ?? DEFAULT_THINKING_TAGS).map(tag => ({ ...tag })));
  const [cross, setCross] = useState(model.thinkingTagsCross === true);
  const personalShown = !privileged || allowUsers;
  const activeScope = privileged && !allowUsers ? "global" : scope;
  // An administrator's workspace values apply to shared templates only; another account's private template is theirs.
  const globalPresets = presets.filter(preset => !preset.ownerId || preset.global || preset.ownerId === accountId);
  const targetPresets = activeScope === "global" ? globalPresets : presets;
  const activeTarget = target === MODEL_TARGET || targetPresets.some(preset => preset.id === target) ? target : MODEL_TARGET;
  const layer = activeScope === "global" ? global : own;
  const setLayer = activeScope === "global" ? setGlobal : setOwn;
  const values = activeTarget === MODEL_TARGET ? layer.base : layer.presets[activeTarget] || {};
  const serverDefaults = served?.samplingDefaults ?? model.samplingDefaults;

  /** What a blank field falls back to, so the placeholder can say it. */
  const inherited = useMemo(() => {
    const g = { base: toParams(global.base) || {}, preset: activeTarget === MODEL_TARGET ? {} : toParams(global.presets[activeTarget] || {}) || {} };
    const o = { base: toParams(own.base) || {} };
    const servedValues = model.isAlias ? served?.samplingParams || {} : {};
    return Object.fromEntries(SAMPLING_KEYS.map(key => {
      const fromGlobalModel = pick(g.base[key], servedValues[key]);
      const value = activeScope === "global"
        ? activeTarget === MODEL_TARGET ? servedValues[key] : fromGlobalModel
        : activeTarget === MODEL_TARGET ? pick(g.preset[key], fromGlobalModel) : pick(o.base[key], toParams(global.presets[activeTarget] || {})?.[key], fromGlobalModel);
      return [key, value];
    })) as Partial<Record<SamplingKey, number>>;
  }, [global, own, activeScope, activeTarget, model.isAlias, served]);

  const anyError = [global, own].some(item => [item.base, ...Object.values(item.presets)].some(strings => SAMPLING_KEYS.some(key => fieldError(key, strings[key]))));
  const tagsInvalid = canEditThinkingTags && tags.some(tag => !tag.start.trim() || !tag.end.trim());

  function setValue(key: SamplingKey, value: string) {
    setLayer(current => activeTarget === MODEL_TARGET ? { ...current, base: { ...current.base, [key]: value } } : { ...current, presets: { ...current.presets, [activeTarget]: { ...(current.presets[activeTarget] || {}), [key]: value } } });
  }
  function resetTarget() {
    // The workspace model values go back to what the server reported; everything else goes back to inheriting.
    const next = activeScope === "global" && activeTarget === MODEL_TARGET && !model.isAlias ? toStrings(serverDefaults) : {};
    setLayer(current => activeTarget === MODEL_TARGET ? { ...current, base: next } : { ...current, presets: { ...current.presets, [activeTarget]: next } });
  }
  function apply() {
    if (anyError || tagsInvalid) return;
    const result: InferenceParamsResult = {};
    if (privileged) {
      result.samplingParams = toParams(global.base);
      result.presetSamplingParams = Object.fromEntries(globalPresets.map(preset => [preset.id, toParams(global.presets[preset.id] || {})]));
      result.userEditable = allowUsers;
      if (canEditThinkingTags) { result.thinkingTags = tags.map(tag => ({ start: tag.start.trim(), end: tag.end.trim() })); result.thinkingTagsCross = cross; }
    }
    if (personalShown) {
      const presetsOut = Object.fromEntries(Object.entries(own.presets).map(([id, strings]) => [id, toParams(strings)]).filter((entry): entry is [string, SamplingParams] => Boolean(entry[1]) && presets.some(preset => preset.id === entry[0])));
      const base = toParams(own.base);
      result.personal = { ...(base ? { base } : {}), ...(Object.keys(presetsOut).length ? { presets: presetsOut } : {}) };
    }
    onApply(result); close();
  }

  const labels: Record<SamplingKey, [string, string]> = ko ? {
    temperature: ["Temperature", "출력의 무작위성을 정합니다. 낮을수록 일관되고, 높을수록 다양합니다. (0–2)"],
    topK: ["Top K 샘플링", "확률이 높은 K개 토큰 중에서만 고릅니다. 낮을수록 보수적입니다."],
    repeatPenalty: ["반복 페널티", "이미 나온 토큰의 확률을 낮춥니다. 1은 페널티 없음입니다."],
    presencePenalty: ["존재 페널티", "한 번이라도 나온 토큰에 페널티를 줘 새 표현을 유도합니다. 0은 없음입니다."],
    topP: ["Top P 샘플링", "누적 확률이 P에 이를 때까지의 토큰만 고려합니다."],
    minP: ["Min P 샘플링", "가장 높은 토큰 확률 대비 이 비율보다 낮은 토큰을 제외합니다."],
  } : {
    temperature: ["Temperature", "How random the output is. Lower is more consistent, higher is more varied. (0–2)"],
    topK: ["Top K sampling", "Pick only among the K most likely tokens. Lower is more conservative."],
    repeatPenalty: ["Repeat penalty", "Lowers the chance of tokens already used. 1 means no penalty."],
    presencePenalty: ["Presence penalty", "Penalises any token that has appeared, nudging toward new wording. 0 means none."],
    topP: ["Top P sampling", "Consider tokens until their cumulative probability reaches P."],
    minP: ["Min P sampling", "Drop tokens below this fraction of the most likely token's probability."],
  };
  const title = ko ? "추론 파라미터 설정" : "Inference parameters";
  const serverText = ko ? "서버 기본값" : "Server default";
  const scopeOptions = [{ value: "global", label: ko ? "전역 기본값" : "Workspace defaults" }, { value: "personal", label: ko ? "내 설정" : "My settings" }] as const;
  const targetOptions = [{ value: MODEL_TARGET, label: ko ? "모델 기본" : "Model default" }, ...targetPresets.map(preset => ({ value: preset.id, label: preset.name, detail: ko ? "추론 강도" : "Reasoning template" }))];
  const scopeHelp = activeScope === "global"
    ? ko ? (allowUsers ? "모든 계정의 기본값입니다. 계정이 자기 값을 정하면 그 값이 우선합니다." : "모든 계정의 요청에 적용됩니다.") : (allowUsers ? "The default for every account; an account's own value takes precedence." : "Applied to every account's requests.")
    : ko ? "이 계정에만 적용되며 다른 사용자와 공유되지 않습니다." : "Applies to this account only and is never shared.";
  const targetHelp = activeTarget === MODEL_TARGET
    ? ko ? "이 모델의 모든 요청에 적용됩니다." : "Applied to every request to this model."
    : ko ? "이 추론 강도를 고른 요청에서 모델 기본값 위에 덮어씁니다." : "Overrides the model default for requests made with this template.";

  return createPortal(<div ref={ref} tabIndex={-1} className={`harness-modal-layer inference-params-layer ${closing ? "modal-closing" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
    <button className="settings-backdrop" tabIndex={-1} onClick={() => close()} aria-label={ko ? "닫기" : "Close"} />
    <form className="harness-dialog inference-params-dialog" onSubmit={(event) => { event.preventDefault(); apply(); }}>
      <header><div><h2>{title}</h2><small>{model.name}</small></div><button type="button" onClick={() => close()} aria-label={ko ? "닫기" : "Close"}><X size={20} /></button></header>
      <div className="inference-params-body">
        {privileged && <div className="inference-params-switch"><div><strong>{ko ? "일반 사용자 변경 허용" : "Let accounts change these"}</strong><small>{ko ? "모든 모델 공통 설정입니다. 켜면 각 계정이 자기 값을 따로 정할 수 있고, 여기서 정한 전역 값은 그 기본값이 됩니다." : "Applies to every model. When on, each account can keep its own values, and the workspace values here become their defaults."}</small></div><button type="button" role="switch" aria-checked={allowUsers} aria-label={ko ? "일반 사용자 변경 허용" : "Let accounts change these"} className={`toggle ${allowUsers ? "on" : ""}`} onClick={() => setAllowUsers(value => !value)}><i /></button></div>}
        {privileged && allowUsers && <div className="reason-mode-switch inference-params-scope" role="radiogroup" aria-label={ko ? "설정 범위" : "Scope"}>{scopeOptions.map(option => <button key={option.value} type="button" role="radio" aria-checked={activeScope === option.value} className={activeScope === option.value ? "active" : ""} onClick={() => setScope(option.value)}>{option.label}</button>)}</div>}
        <p className="harness-dialog-help">{scopeHelp}</p>
        {targetOptions.length > 1 && <div className="inference-params-target"><span>{ko ? "적용 대상" : "Applies to"}</span><SelectMenu label={ko ? "적용 대상" : "Applies to"} value={activeTarget} options={targetOptions} onChange={setTarget} /><small>{targetHelp}</small></div>}
        <div className="inference-params-head"><strong>{ko ? "샘플링" : "Sampling"}</strong><button type="button" className="subtle-action" onClick={resetTarget}><RotateCcw size={14} />{activeScope === "global" && activeTarget === MODEL_TARGET && !model.isAlias ? (ko ? "서버 기본값으로" : "Server defaults") : (ko ? "모두 비우기" : "Clear all")}</button></div>
        <div className="inference-params-grid">{SAMPLING_KEYS.map(key => {
          const limits = SAMPLING_LIMITS[key]; const invalid = fieldError(key, values[key]);
          const fallback = inherited[key];
          const placeholder = fallback !== undefined ? `${ko ? "상속" : "Inherit"} · ${fallback}` : serverText;
          return <label key={key} className={`inference-param ${invalid ? "invalid" : ""}`}>
            <span><strong>{labels[key][0]}</strong><small>{labels[key][1]}</small></span>
            <span className="inference-param-input"><input type="number" inputMode="decimal" min={limits.min} max={limits.max} step={limits.step} value={values[key] ?? ""} placeholder={placeholder} aria-label={labels[key][0]} aria-invalid={invalid} onChange={(event) => setValue(key, event.target.value)} />
              <small>{invalid ? (ko ? `${limits.min}–${limits.max}${limits.integer ? " 정수" : ""}` : `${limits.min}–${limits.max}${limits.integer ? ", whole number" : ""}`) : serverDefaults?.[key] !== undefined ? `${serverText} ${serverDefaults[key]}` : ko ? "비우면 서버가 정함" : "Blank lets the server decide"}</small></span>
          </label>;
        })}</div>
        {privileged && canEditThinkingTags && activeScope === "global" && <div className="thinking-tags-field inference-thinking-tags"><div className="thinking-tags-head"><div><strong>{ko ? "생각 태그" : "Thinking tags"}</strong><small>{ko ? "이 모델이 생각 앞뒤에 쓰는 시작·끝 태그입니다. 서버가 생각과 답변을 나누지 못하거나 답변까지 생각으로 보낼 때 이 쌍으로 나눕니다. 태그 앞뒤에 공백이 없어도 인식합니다." : "Start and end tags this model writes around its reasoning. When the server does not split reasoning from the answer, or puts the whole reply in reasoning, these pairs separate them. Tags need no surrounding spaces."}</small></div><button type="button" className="subtle-action" disabled={JSON.stringify(tags) === JSON.stringify(DEFAULT_THINKING_TAGS)} onClick={() => setTags(DEFAULT_THINKING_TAGS.map(tag => ({ ...tag })))}><RotateCcw size={14} />{ko ? "기본값으로" : "Restore defaults"}</button></div>
          {tags.map((tag, index) => <div className="thinking-tag-row" key={index}><input aria-label={`${ko ? "시작 태그" : "Start tag"} ${index + 1}`} placeholder={ko ? "시작 태그" : "Start tag"} value={tag.start} maxLength={64} spellCheck={false} onChange={(event) => setTags(tags.map((item, at) => at === index ? { ...item, start: event.target.value } : item))} /><span aria-hidden="true">…</span><input aria-label={`${ko ? "끝 태그" : "End tag"} ${index + 1}`} placeholder={ko ? "끝 태그" : "End tag"} value={tag.end} maxLength={64} spellCheck={false} onChange={(event) => setTags(tags.map((item, at) => at === index ? { ...item, end: event.target.value } : item))} /><button type="button" className="thinking-tag-remove" aria-label={`${ko ? "태그 쌍 삭제" : "Remove tag pair"} ${index + 1}`} title={ko ? "태그 쌍 삭제" : "Remove tag pair"} onClick={() => setTags(tags.filter((_, at) => at !== index))}><Trash2 size={14} /></button></div>)}
          {!tags.length && <small className="thinking-tags-empty">{ko ? "태그 없음: 서버가 보낸 그대로 사용합니다." : "No tags: the text is used as the server sent it."}</small>}
          <div className="thinking-tags-cross"><div><strong>{ko ? "크로스로 허용하기" : "Allow crossed pairs"}</strong><small>{ko ? "어느 시작 태그로 연 생각이든 목록의 어느 끝 태그로도 닫습니다. 시작과 끝 태그의 형식이 서로 달라도 생각과 답변을 나눌 수 있습니다." : "Any end tag closes reasoning opened by any start tag, so a model that opens with one format and closes with another is still split."}</small></div><button type="button" role="switch" aria-label={ko ? "크로스로 허용하기" : "Allow crossed pairs"} aria-checked={cross} className={`toggle ${cross ? "on" : ""}`} onClick={() => setCross(value => !value)}><i /></button></div>
          <button type="button" className="subtle-action" disabled={tags.length >= 12} onClick={() => setTags([...tags, { start: "", end: "" }])}><Plus size={14} />{ko ? "태그 쌍 추가" : "Add tag pair"}</button>
          {tagsInvalid && <small className="inference-params-error">{ko ? "빈 태그가 있습니다. 채우거나 삭제해 주세요." : "Fill in or remove the empty tags."}</small>}</div>}
        {privileged && model.isAlias && activeScope === "global" && <p className="settings-help">{ko ? "Alias는 실행 중인 기반 모델의 생각 태그를 사용합니다." : "Aliases use the thinking tags of the base model they run on."}</p>}
      </div>
      <footer className="text-dialog-actions"><small>{ko ? "적용 후 설정 저장을 눌러야 반영됩니다." : "Save settings after applying to keep the changes."}</small>
        <button type="button" className="secondary-button" onClick={() => close()}>{ko ? "취소" : "Cancel"}</button>
        <button type="submit" className="save-button" disabled={anyError || tagsInvalid}>{ko ? "적용" : "Apply"}</button></footer>
    </form>
  </div>, document.body);
}
