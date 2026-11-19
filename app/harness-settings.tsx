"use client";
import { useState } from "react";
import { Pencil, Check, Layers, Type, RotateCw, Minimize2, Eraser, Clock, Zap, HardDrive, Repeat2 } from "lucide-react";
import type { HarnessSettings, PublicConfig } from "@/lib/types";
import { DEFAULT_HARNESS_SETTINGS } from "@/lib/harness";
import { normalizeRepetitionSettings, REPETITION_KINDS, REPETITION_LIMITS, type RepetitionKind } from "@/lib/repetition";
import { SectionTitle } from "./section-title";
import { SelectMenu } from "./select-menu";
import { TextDialog } from "./text-dialog";

const EFFORT_LABELS: Record<string, [string, string]> = {
  off: ["Off", "사용 안 함"], on: ["Thinking", "사고 사용"], minimal: ["Minimal", "최소"],
  low: ["Low", "낮음"], medium: ["Medium", "보통"], high: ["High", "높음"], xhigh: ["Extra high", "매우 높음"],
};

// Radio cards keep the harness modes and title timings comparable at a glance.
function OptionCards({ label, options, value, onSelect }: { label:string; options:Array<{ id:string; icon:React.ReactNode; title:string; description:string }>; value:string; onSelect:(id:string)=>void }) {
  return <div className="option-cards" role="radiogroup" aria-label={label}>{options.map(option => <button key={option.id} type="button" role="radio" aria-checked={value===option.id} className={value===option.id ? "active" : ""} onClick={()=>onSelect(option.id)}><span className="option-card-icon">{option.icon}</span><div><strong>{option.title}</strong><small>{option.description}</small></div>{value===option.id && <Check size={16}/>}</button>)}</div>;
}

export function StorageSettingsPanel({draft,setDraft}: {draft:PublicConfig;setDraft:React.Dispatch<React.SetStateAction<PublicConfig>>}) {
  const ko=draft.preferences.language==="ko";
  const harness=draft.harnessSettings||DEFAULT_HARNESS_SETTINGS;
  const quotaUnit=(bytes:number):"MB"|"GB"=>bytes>=1024**3&&bytes%1024**3===0?"GB":"MB";
  const [storageUnit,setStorageUnit]=useState<"MB"|"GB">(()=>quotaUnit(draft.userStorageSettings.defaultQuotaBytes));
  const [trashUnit,setTrashUnit]=useState<"MB"|"GB">(()=>quotaUnit(draft.userStorageSettings.defaultTrashQuotaBytes));
  const patchStorage=(value:Partial<PublicConfig["userStorageSettings"]>)=>setDraft(d=>({...d,userStorageSettings:{...d.userStorageSettings,...value}}));
  const patchHarness=(value:Partial<HarnessSettings>)=>setDraft(d=>({...d,harnessSettings:{...(d.harnessSettings||DEFAULT_HARNESS_SETTINGS),...value}}));
  const quotaValue=(bytes:number,unit:"MB"|"GB")=>bytes/(unit==="GB"?1024**3:1024**2);
  const quotaBytes=(value:number,unit:"MB"|"GB")=>Math.round(value*(unit==="GB"?1024**3:1024**2));
  return <div className="settings-section wide storage-settings-section">
    <SectionTitle icon={<HardDrive size={19}/>} title={ko?"저장소 관리":"Storage management"} description={ko?<><span>사용자 저장소·휴지통의 기본 할당량과 삭제 보존 기간을 관리합니다.</span><span>할당량이 0인 사용자는 이 기본값을 자동으로 따릅니다.</span></>:<><span>Manage workspace defaults for user storage, trash, and deleted-item retention.</span><span>Users whose quota is set to zero automatically inherit these values.</span></>}/>
    <div className="settings-group">
      <h4>{ko?"아티팩트 저장":"Artifact storage"}</h4>
      <div className="general-setting-card general-toggle-card">
        <div><strong>{ko?"아티팩트를 저장소에 자동 저장":"Automatically save artifacts to storage"}</strong><small>{ko?"같은 대화의 동일한 아티팩트는 덮어쓰고, 다른 대화와 파일명이 겹치면 (n)을 붙여 별도 저장합니다.":"Overwrite the same artifact within a conversation; add (n) when its filename conflicts with another conversation."}</small></div>
        <button type="button" role="switch" aria-label={ko?"아티팩트 자동 저장":"Artifact auto-save"} aria-checked={harness.artifactAutoSaveToStorage} className={`toggle ${harness.artifactAutoSaveToStorage?"on":""}`} onClick={()=>patchHarness({artifactAutoSaveToStorage:!harness.artifactAutoSaveToStorage})}><i/></button>
      </div>
    </div>
    <div className="settings-group">
      <h4>{ko?"기본 할당량":"Default quotas"}</h4>
      <div className="storage-default-grid">
        <label className="field"><span>{ko?"기본 저장소 할당량":"Default storage quota"}</span><div className="storage-default-value"><input type="number" min={1} max={storageUnit==="GB"?10240:10485760} step={storageUnit==="GB"?.25:1} value={quotaValue(draft.userStorageSettings.defaultQuotaBytes,storageUnit)} onChange={e=>patchStorage({defaultQuotaBytes:quotaBytes(Number(e.target.value),storageUnit)})}/><SelectMenu label={ko?"저장소 기본 단위":"Storage default unit"} value={storageUnit} options={[{value:"MB",label:"MB"},{value:"GB",label:"GB"}]} onChange={value=>setStorageUnit(value as "MB"|"GB")}/></div><small>{ko?"신규 사용자와 저장소 할당량이 0인 모든 사용자에게 적용됩니다.":"Applies to new users and every user whose storage quota is set to zero."}</small></label>
        <label className="field"><span>{ko?"기본 휴지통 할당량":"Default trash quota"}</span><div className="storage-default-value"><input type="number" min={1} max={trashUnit==="GB"?20480:20971520} step={trashUnit==="GB"?.25:1} value={quotaValue(draft.userStorageSettings.defaultTrashQuotaBytes,trashUnit)} onChange={e=>patchStorage({defaultTrashQuotaBytes:quotaBytes(Number(e.target.value),trashUnit)})}/><SelectMenu label={ko?"휴지통 기본 단위":"Trash default unit"} value={trashUnit} options={[{value:"MB",label:"MB"},{value:"GB",label:"GB"}]} onChange={value=>setTrashUnit(value as "MB"|"GB")}/></div><small>{ko?"신규 사용자와 휴지통 할당량이 0인 모든 사용자에게 적용됩니다.":"Applies to new users and every user whose trash quota is set to zero."}</small></label>
      </div>
    </div>
    <div className="settings-group">
      <h4>{ko?"삭제 보존":"Deleted-item retention"}</h4>
      <div className="tool-settings-grid storage-retention-grid"><label className="field"><span>{ko?"삭제 보존 기간":"Retention period"}</span><input type="number" min={1} max={60} step={1} value={draft.userStorageSettings.trashRetentionDays} onChange={e=>patchStorage({trashRetentionDays:Math.min(60,Math.max(1,Math.floor(Number(e.target.value)||1)))})}/><small>{ko?"삭제된 채팅과 파일을 서버에 보존하는 기간입니다. 1~60일 사이에서 설정합니다.":"How long deleted chats and files remain on the server, from 1 to 60 days."}</small></label></div>
    </div>
  </div>;
}

const REPETITION_COPY: Record<RepetitionKind, { title: [string, string]; detail: [string, string] }> = {
  word: { title: ["Word repetition", "단어 반복"], detail: ["The same word in a row, e.g. “apple apple apple…”.", "같은 단어가 연달아 나옴. 예: “apple apple apple…”"] },
  sentence: { title: ["Sentence repetition", "문장 반복"], detail: ["The same sentence in a row.", "같은 문장이 연달아 나옴."] },
  paragraph: { title: ["Paragraph repetition", "문단 반복"], detail: ["The same paragraph in a row. Identical tool calls in a row count here too.", "같은 문단이 연달아 나옴. 같은 도구 호출이 연달아 나오는 것도 여기에 포함됩니다."] },
  paragraphGroup: { title: ["Paragraph-group repetition", "문단 묶음 반복"], detail: ["Several paragraphs repeated together as one block. Repeated sequences of tool calls count here too.", "여러 문단이 한 묶음으로 반복됨. 도구 호출 묶음의 반복도 여기에 포함됩니다."] },
};

/** Per-kind switches and thresholds for the repetitive-output alert. */
function RepetitionSettingsSection({ ko, value, onChange }: { ko: boolean; value: HarnessSettings["repetitionDetection"] | undefined; onChange: (value: HarnessSettings["repetitionDetection"]) => void }) {
  const rules = normalizeRepetitionSettings(value);
  const set = (kind: RepetitionKind, rule: Partial<typeof rules[RepetitionKind]>) => onChange({ ...rules, [kind]: { ...rules[kind], ...rule } });
  return <section className="settings-section wide">
    <SectionTitle icon={<Repeat2 size={19}/>} title={ko?"반복 출력 감지":"Repetitive output detection"} description={ko?"추론, 응답, 도구 호출에서 같은 내용이 연속으로 반복되면 사용자에게 정지·다시 시도·무시를 묻는 알림을 띄웁니다.":"When reasoning, the response or tool calls repeat the same content in a row, the user is asked whether to stop, retry or ignore it."}/>
    <div className="repetition-rules">{REPETITION_KINDS.map(kind => { const rule = rules[kind]; const copy = REPETITION_COPY[kind]; const { min, max } = REPETITION_LIMITS[kind]; return <div key={kind} className={`general-setting-card repetition-rule ${rule.enabled ? "" : "disabled"}`}>
      <div><strong>{copy.title[ko?1:0]}</strong><small>{copy.detail[ko?1:0]}</small></div>
      <label className="repetition-threshold"><input type="number" min={min} max={max} step={1} inputMode="numeric" disabled={!rule.enabled} value={rule.threshold} aria-label={`${copy.title[ko?1:0]} ${ko?"감지 횟수":"threshold"}`} onChange={e=>set(kind,{ threshold: Math.min(max, Math.max(min, Math.floor(Number(e.target.value) || min))) })}/><small>{ko?"회 연속":"in a row"}</small></label>
      <button type="button" role="switch" aria-label={copy.title[ko?1:0]} aria-checked={rule.enabled} className={`toggle ${rule.enabled?"on":""}`} onClick={()=>set(kind,{ enabled: !rule.enabled })}><i/></button>
    </div>; })}</div>
    <p className="settings-help">{ko?`횟수는 연속으로 나온 경우만 셉니다. 기본값은 단어 20회, 문장 5회, 문단 5회, 문단 묶음 2회입니다. 짧은 줄(예: 코드의 닫는 괄호)은 문장·문단으로 세지 않습니다.`:`Only consecutive copies count. Defaults: words 20, sentences 5, paragraphs 5, paragraph groups 2. Very short lines, such as a closing bracket in code, are not counted as sentences or paragraphs.`}</p>
  </section>;
}

export function HarnessSettingsPanel({draft,setDraft}: {draft:PublicConfig;setDraft:React.Dispatch<React.SetStateAction<PublicConfig>>}) {
  const ko=draft.preferences.language==="ko";
  const h=draft.harnessSettings || DEFAULT_HARNESS_SETTINGS;
  const [prompt,setPrompt]=useState<"compactPrompt"|"resumePrompt"|"titlePrompt"|null>(null);
  const patch=(value:Partial<HarnessSettings>)=>setDraft(d=>({...d,harnessSettings:{...(d.harnessSettings || DEFAULT_HARNESS_SETTINGS),...value}}));
  const effortLabel=(value:string)=>{ const label=EFFORT_LABELS[value]; return label ? label[ko?1:0] : value; };
  function modelFields(kind:"compact"|"title") {
    const modelKey=kind==="compact"?"compactModelId":"titleModelId";
    const effortKey=kind==="compact"?"compactEffort":"titleEffort";
    const model=draft.models.find(m=>m.id===h[modelKey]);
    const efforts=model?.reasoningEfforts || ["off","on","minimal","low","medium","high","xhigh"];
    const modelLabel = ko?"사용할 모델":"Model";
    const effortLabelText = ko?"추론 강도":"Reasoning effort";
    return <div className="form-grid">
      <label className="field"><span>{modelLabel}</span><SelectMenu label={modelLabel} value={h[modelKey]} options={[{ value:"", label:ko?"현재 채팅의 기반 모델":"Current chat's base model" },...draft.models.filter(m=>!m.isAlias && m.visible!==false).map(m=>({ value:m.id, label:m.name }))]} onChange={value=>patch({[modelKey]:value,[effortKey]:"off"})}/><small>{ko?"비워 두면 대화에서 선택한 모델을 그대로 사용합니다.":"Left unset, the model selected in the chat is used."}</small></label>
      <label className="field"><span>{effortLabelText}</span><SelectMenu label={effortLabelText} value={h[effortKey]} options={[...new Set(["off",...efforts])].map(value=>({ value, label:effortLabel(value) }))} onChange={value=>patch({[effortKey]:value})}/><small>{ko?"모델이 지원하는 강도만 전달됩니다.":"Only model-supported values are sent."}</small></label>
    </div>;
  }
  return <div className="harness-settings">
    <section className="settings-section wide">
      <SectionTitle icon={<Layers size={19}/>} title={ko?"컨텍스트 처리":"Context handling"} description={ko?"모델의 컨텍스트 창이 가득 찼을 때 이전 대화를 어떻게 다룰지 정합니다.":"Choose what happens to earlier turns once the model's context window fills up."}/>
      <OptionCards label={ko?"기본 처리 방식":"Base method"} value={h.contextMode} onSelect={id=>patch({contextMode:id as HarnessSettings["contextMode"]})} options={[
        { id:"rolling", icon:<RotateCw size={17}/>, title:ko?"롤링":"Rolling", description:ko?"가장 오래된 메시지부터 전달 대상에서 제외합니다.":"Drop the oldest messages from the model input." },
        { id:"compacting", icon:<Minimize2 size={17}/>, title:ko?"압축":"Compacting", description:ko?"이전 대화를 요약해 맥락으로 계속 유지합니다.":"Summarize earlier turns and keep the summary in context." },
      ]}/>
      <div className="general-setting-card general-toggle-card drop-details-card">
        <div><strong><Eraser size={15}/>{ko?"세부 내용 먼저 버리기":"Drop details first"}</strong><small>{ko
          ?`임계값에 도달하면 모델 호출 없이 이전 턴의 도구 호출·도구 결과·추론을 먼저 버립니다. 그래도 임계값을 넘을 때만 위의 기본 처리 방식(${h.contextMode==="compacting"?"압축":"롤링"})으로 이어집니다. 응답 도중에는 가장 최근 도구 호출과 결과를 남깁니다.`
          :`At the threshold, earlier tool calls, tool results and reasoning are dropped first, without a model call. Only if it is still over does the base method above (${h.contextMode==="compacting"?"Compacting":"Rolling"}) take over. During a reply the newest tool call and its results stay.`}</small></div>
        <button type="button" role="switch" aria-label={ko?"세부 내용 먼저 버리기":"Drop details first"} aria-checked={h.dropDetailsFirst} className={`toggle ${h.dropDetailsFirst?"on":""}`} onClick={()=>patch({dropDetailsFirst:!h.dropDetailsFirst})}><i/></button>
      </div>
      {(h.contextMode==="compacting" || h.dropDetailsFirst) && <div className="harness-advanced">
        <h4>{ko?"임계값":"Threshold"}</h4>
        <div className="field"><span id="compact-threshold-label">{ko?"처리 시작 임계값":"Start at"}</span><div className="harness-slider"><input type="range" min={10} max={95} step={1} value={h.compactThreshold} aria-labelledby="compact-threshold-label" onChange={e=>patch({compactThreshold:Number(e.target.value)})}/><b>{h.compactThreshold}%</b></div><small>{ko
          ?`컨텍스트 사용량이 이 비율에 도달하면 ${[h.dropDetailsFirst?"세부 내용 버리기":"", h.contextMode==="compacting"?(h.dropDetailsFirst?"(그래도 넘으면) 요약":"요약"):(h.dropDetailsFirst?"(그래도 넘으면) 오래된 턴 제외":"")].filter(Boolean).join(" → ")}을 시작합니다.`
          :`Once context usage reaches this share of the window: ${[h.dropDetailsFirst?"drop details":"", h.contextMode==="compacting"?(h.dropDetailsFirst?"then summarize if still over":"summarize"):(h.dropDetailsFirst?"then remove the oldest turns if still over":"")].filter(Boolean).join(", ")}.`}</small></div>
      </div>}
      {h.contextMode==="compacting" && <div className="harness-advanced">
        <h4>{ko?"압축 옵션":"Compaction options"}</h4>
        {modelFields("compact")}
        <div className="harness-prompt-actions"><button type="button" className="subtle-action" onClick={()=>setPrompt("compactPrompt")}><Pencil size={16}/>{ko?"압축 프롬프트 편집":"Edit compacting prompt"}</button>
        <button type="button" className="subtle-action" onClick={()=>setPrompt("resumePrompt")}><Pencil size={16}/>{ko?"재개 프롬프트 편집":"Edit resume prompt"}</button></div>
        <label className="field"><span>{ko?"압축 프롬프트 위치":"Compacting prompt position"}</span><SelectMenu label={ko?"압축 프롬프트 위치":"Compacting prompt position"} value={h.compactPromptPosition||"after"} options={[{value:"after",label:ko?"대화 내용 뒤 (기본값)":"After the conversation (default)"},{value:"before",label:ko?"대화 내용 앞 (시스템 프롬프트)":"Before the conversation (system prompt)"}]} onChange={value=>patch({compactPromptPosition:value as HarnessSettings["compactPromptPosition"]})}/><small>{h.compactPrompt.includes("{CHAT_CONTENT}")?(ko?"프롬프트에 {CHAT_CONTENT}가 있어 그 자리에 대화 내용이 들어갑니다. 이 설정은 무시됩니다.":"The prompt contains {CHAT_CONTENT}, so the conversation goes there and this setting is ignored."):(ko?"프롬프트에 {CHAT_CONTENT}를 넣으면 그 자리에 대화 내용이 들어갑니다.":"Put {CHAT_CONTENT} in the prompt to place the conversation exactly there.")}</small></label>
        <label className="field"><span>{ko?"출력 중 압축 후 최대 재개 횟수":"Maximum compaction resumes per response"}</span><input type="number" min={0} max={100} step={1} value={h.maxCompactionResumes} onChange={e=>patch({maxCompactionResumes:Math.min(100,Math.max(0,Math.floor(Number(e.target.value)||0)))})}/><small>{ko?"기본 3회. 0이면 출력 중 임계값 도달 시 재개하지 않습니다. 전송 전 압축은 제외됩니다.":"Default: 3. Zero stops at the first output threshold. Pre-send compaction does not count."}</small></label>
      </div>}
      <div className="harness-advanced">
        <h4>{ko?"응답 길이":"Response length"}</h4>
        <label className="field"><span>{ko?"응답 최대 토큰":"Maximum output tokens"}</span><input type="number" min={0} max={1000000} step={1} inputMode="numeric" value={h.maxOutputTokens} onChange={e=>patch({maxOutputTokens:Math.min(1000000,Math.max(0,Math.floor(Number(e.target.value) || 0)))})}/><small>{ko?"0은 제한 없음입니다. 남은 컨텍스트 공간을 모두 응답에 사용할 수 있습니다. 값을 지정하면 그 값과 남은 공간 중 작은 쪽을 상한으로 전달합니다.":"0 means no limit, so a response may use all of the remaining context. A value is sent as the smaller of itself and the remaining space."}</small></label>
      </div>
      <p className="settings-help">{ko?"채팅 원문은 모든 분기에 보존됩니다. 컨텍스트 사용량은 모델 전달 내용을 반영하며, 서버 사용량이 없으면 추정값입니다.":"Original history is preserved in every branch. Context usage reflects model input, estimated when server usage is unavailable."}</p>
    </section>
    <section className="settings-section wide">
      <SectionTitle icon={<Type size={19}/>} title={ko?"채팅 제목 생성":"Chat titles"} description={ko?"새 대화의 제목을 모델이 대신 지어 주도록 설정합니다.":"Let a model name each new conversation for you."}/>
      <div className="general-setting-card general-toggle-card">
        <div><strong>{ko?"제목 자동 생성":"Generate titles automatically"}</strong><small>{ko?"첫 번째 대화를 바탕으로 제목을 만듭니다. 직접 변경한 제목은 그대로 유지됩니다.":"Titles come from the first exchange. Titles you set yourself are kept."}</small></div>
        <button role="switch" aria-label={ko?"제목 자동 생성":"Generate titles automatically"} aria-checked={h.titleEnabled} className={`toggle ${h.titleEnabled?"on":""}`} onClick={()=>patch({titleEnabled:!h.titleEnabled})}><i/></button>
      </div>
      {h.titleEnabled && <div className="harness-advanced">
        <h4>{ko?"생성 시점":"Timing"}</h4>
        <OptionCards label={ko?"생성 시점":"Timing"} value={h.titleTiming} onSelect={id=>patch({titleTiming:id as HarnessSettings["titleTiming"]})} options={[
          { id:"after", icon:<Clock size={17}/>, title:ko?"응답 후":"After the response", description:ko?"첫 응답이 끝난 뒤, 완성된 답변까지 참고해 정확한 제목을 만듭니다.":"Runs after the first reply, so the finished answer shapes the title." },
          { id:"before", icon:<Zap size={17}/>, title:ko?"응답 전":"Before the response", description:ko?"첫 프롬프트를 보낸 직후에 제목이 바로 나타납니다.":"Runs as the first prompt is sent, so the title appears immediately." },
        ]}/>
        {modelFields("title")}
        <button type="button" className="subtle-action" onClick={()=>setPrompt("titlePrompt")}><Pencil size={16}/>{ko?"제목 생성 프롬프트 편집":"Edit title prompt"}</button>
      </div>}
    </section>
    <RepetitionSettingsSection ko={ko} value={h.repetitionDetection} onChange={repetitionDetection=>patch({repetitionDetection})}/>
    {prompt&&<TextDialog title={prompt==="compactPrompt"?(ko?"압축 프롬프트":"Compacting prompt"):prompt==="resumePrompt"?(ko?"재개 프롬프트":"Resume prompt"):(ko?"제목 생성 프롬프트":"Title prompt")} help={prompt==="compactPrompt"?(ko?"{CHAT_CONTENT}는 압축할 대화 내용으로 치환됩니다. 없으면 '압축 프롬프트 위치' 설정에 따라 대화 내용의 뒤(기본값) 또는 앞에 프롬프트가 들어갑니다.":"{CHAT_CONTENT} is replaced with the conversation being compacted. Without it, the prompt goes after (default) or before the conversation, as set in Compacting prompt position."):prompt==="resumePrompt"?(ko?"출력을 재개할 때 사용합니다. %COMPRESSED%는 압축된 맥락으로, %USER_PROMPT%는 원래 사용자 메시지로 치환됩니다.":"Used when resuming an interrupted response. %COMPRESSED% is replaced with the compacted context and %USER_PROMPT% with the original user message."):undefined} value={h[prompt]} multiline ko={ko} onClose={()=>setPrompt(null)} onSave={text=>{patch({[prompt]:text});setPrompt(null);}}/>}
  </div>;
}
