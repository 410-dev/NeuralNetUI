"use client";
import { useState } from "react";
import { createPortal } from "react-dom";
import { X, Pencil, Check, Layers, Type, RotateCw, Minimize2, Clock, Zap, ShieldCheck, ShieldQuestion, ShieldX } from "lucide-react";
import type { HarnessSettings, PublicConfig } from "@/lib/types";
import { DEFAULT_HARNESS_SETTINGS } from "@/lib/harness";
import { useModalFocus } from "@/lib/use-modal-focus";
import { SectionTitle } from "./section-title";
import { SelectMenu } from "./select-menu";

const EFFORT_LABELS: Record<string, [string, string]> = {
  off: ["Off", "사용 안 함"], on: ["Thinking", "사고 사용"], minimal: ["Minimal", "최소"],
  low: ["Low", "낮음"], medium: ["Medium", "보통"], high: ["High", "높음"], xhigh: ["Extra high", "매우 높음"],
};

export function TextDialog({ title, value, onSave, onClose, multiline = false, help }: { title:string; value:string; onSave:(value:string)=>void; onClose:()=>void; multiline?:boolean; help?:string }) {
  const [text,setText] = useState(value);
  const ref = useModalFocus(onClose);
  return createPortal(<div ref={ref} tabIndex={-1} className="harness-modal-layer" role="dialog" aria-modal="true" aria-label={title}><button className="settings-backdrop" tabIndex={-1} onClick={onClose} aria-label="Close"/><form className="harness-dialog" onSubmit={e=>{e.preventDefault();if(text.trim())onSave(text.trim());}}><header><h2>{title}</h2><button type="button" onClick={onClose} aria-label="Close"><X size={20}/></button></header>{help && <p className="harness-dialog-help">{help}</p>}{multiline ? <textarea aria-label={title} rows={16} maxLength={32000} value={text} onChange={e=>setText(e.target.value)}/> : <input aria-label={title} maxLength={200} value={text} onChange={e=>setText(e.target.value)}/>}<button className="save-button" disabled={!text.trim()}>OK</button></form></div>,document.body);
}

// Radio cards keep the harness modes and title timings comparable at a glance.
function OptionCards({ label, options, value, onSelect }: { label:string; options:Array<{ id:string; icon:React.ReactNode; title:string; description:string }>; value:string; onSelect:(id:string)=>void }) {
  return <div className="option-cards" role="radiogroup" aria-label={label}>{options.map(option => <button key={option.id} type="button" role="radio" aria-checked={value===option.id} className={value===option.id ? "active" : ""} onClick={()=>onSelect(option.id)}><span className="option-card-icon">{option.icon}</span><div><strong>{option.title}</strong><small>{option.description}</small></div>{value===option.id && <Check size={16}/>}</button>)}</div>;
}

export function HarnessSettingsPanel({draft,setDraft}: {draft:PublicConfig;setDraft:React.Dispatch<React.SetStateAction<PublicConfig>>}) {
  const ko=draft.preferences.language==="ko";
  const h=draft.harnessSettings || DEFAULT_HARNESS_SETTINGS;
  const [prompt,setPrompt]=useState<"compactPrompt"|"resumePrompt"|"titlePrompt"|"hostCommandAnalysisPrompt"|null>(null);
  const superadmin=draft.account?.role==="superadmin";
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
      <OptionCards label={ko?"처리 방식":"Mode"} value={h.contextMode} onSelect={id=>patch({contextMode:id as HarnessSettings["contextMode"]})} options={[
        { id:"rolling", icon:<RotateCw size={17}/>, title:ko?"롤링":"Rolling", description:ko?"가장 오래된 메시지부터 전달 대상에서 제외합니다.":"Drop the oldest messages from the model input." },
        { id:"compacting", icon:<Minimize2 size={17}/>, title:ko?"압축":"Compacting", description:ko?"이전 대화를 요약해 맥락으로 계속 유지합니다.":"Summarize earlier turns and keep the summary in context." },
      ]}/>
      {h.contextMode==="compacting" && <div className="harness-advanced">
        <h4>{ko?"압축 옵션":"Compaction options"}</h4>
        <div className="field"><span id="compact-threshold-label">{ko?"압축 시작 임계값":"Start compacting at"}</span><div className="harness-slider"><input type="range" min={10} max={95} step={1} value={h.compactThreshold} aria-labelledby="compact-threshold-label" onChange={e=>patch({compactThreshold:Number(e.target.value)})}/><b>{h.compactThreshold}%</b></div><small>{ko?"컨텍스트 사용량이 이 비율에 도달하면 요약을 시작합니다.":"Summarization starts once context usage reaches this share of the window."}</small></div>
        {modelFields("compact")}
        <div className="harness-prompt-actions"><button type="button" className="subtle-action" onClick={()=>setPrompt("compactPrompt")}><Pencil size={16}/>{ko?"압축 프롬프트 편집":"Edit compacting prompt"}</button>
        <button type="button" className="subtle-action" onClick={()=>setPrompt("resumePrompt")}><Pencil size={16}/>{ko?"재개 프롬프트 편집":"Edit resume prompt"}</button></div>
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
    {superadmin && <section className="settings-section wide">
      <SectionTitle icon={<ShieldCheck size={19}/>} title={ko?"호스트 컴퓨터 권한":"Host computer permissions"} description={ko?"Superadmin 전용 에이전트 작업의 확인 범위와 독립 셸 명령 분석기를 설정합니다.":"Set confirmation boundaries and the isolated shell-command assessor for the Superadmin-only agent tool."}/>
      <OptionCards label={ko?"신뢰 수준":"Trust mode"} value={h.hostTrustMode} onSelect={id=>patch({hostTrustMode:id as HarnessSettings["hostTrustMode"]})} options={[
        { id:"full", icon:<ShieldCheck size={17}/>, title:ko?"완전 신뢰":"Full trust", description:ko?"어떤 작업에도 확인을 요청하지 않습니다.":"Never ask before a host action." },
        { id:"partial", icon:<ShieldQuestion size={17}/>, title:ko?"부분 신뢰":"Partial trust", description:ko?"아래에서 선택한 위험도만 자동 허용합니다.":"Auto-allow only the selected risk levels." },
        { id:"none", icon:<ShieldX size={17}/>, title:ko?"신뢰 안 함":"No trust", description:ko?"모든 호스트 작업을 매번 확인합니다.":"Confirm every host action." },
      ]}/>
      {h.hostTrustMode==="partial" && <div className="harness-advanced host-risk-matrix"><h4>{ko?"자동 허용 위험도":"Automatically trusted risk levels"}</h4>{[
        ko?"1단계 · 파일 내용을 읽지 않는 상태 및 메타데이터 확인":"Level 1 · Status and metadata inspection without file contents",
        ko?"2단계 · 파일 내용 또는 현재 화면 읽기":"Level 2 · Read file contents or the current screen",
        ko?"3단계 · 생성, 수정, 복사, 이름·위치 변경, 실행 또는 업로드":"Level 3 · Create, modify, copy, rename, move, run, or upload",
        ko?"4단계 · 영구 삭제 또는 프로세스 종료":"Level 4 · Permanent deletion or process termination",
        ko?"5단계 · 컴퓨터 설정 변경 또는 목적 밖 작업":"Level 5 · Computer configuration or out-of-scope work",
      ].map((label,index)=><div className="general-setting-card general-toggle-card" key={label}><div><strong>{label}</strong></div><button type="button" role="switch" aria-label={label} aria-checked={h.hostTrustedRiskLevels[index]===true} className={`toggle ${h.hostTrustedRiskLevels[index]?"on":""}`} onClick={()=>{const levels=[...h.hostTrustedRiskLevels];levels[index]=!levels[index];patch({hostTrustedRiskLevels:levels});}}><i/></button></div>)}</div>}
      <div className="harness-advanced"><h4>{ko?"독립 셸 명령 분석":"Isolated shell-command analysis"}</h4><div className="form-grid">
        <label className="field"><span>{ko?"분석 모델":"Assessment model"}</span><SelectMenu label={ko?"분석 모델":"Assessment model"} value={h.hostCommandModelId} options={[{value:"",label:ko?"현재 채팅의 기반 모델":"Current chat's base model"},...draft.models.filter(m=>!m.isAlias&&m.visible!==false).map(m=>({value:m.id,label:m.name}))]} onChange={value=>patch({hostCommandModelId:value,hostCommandEffort:"off"})}/><small>{ko?"명령어만 포함하는 별도 요청이며 채팅 기록을 전달하지 않습니다.":"This separate request contains only the command, never chat history."}</small></label>
        <label className="field"><span>{ko?"추론 강도":"Reasoning effort"}</span><SelectMenu label={ko?"추론 강도":"Reasoning effort"} value={h.hostCommandEffort} options={[...new Set(["off",...(draft.models.find(m=>m.id===h.hostCommandModelId)?.reasoningEfforts||["on","minimal","low","medium","high","xhigh"])])].map(value=>({value,label:effortLabel(value)}))} onChange={value=>patch({hostCommandEffort:value})}/></label>
      </div><button type="button" className="subtle-action" onClick={()=>setPrompt("hostCommandAnalysisPrompt")}><Pencil size={16}/>{ko?"위험도 분석 프롬프트 편집":"Edit risk-analysis prompt"}</button></div>
    </section>}
    {prompt&&<TextDialog title={prompt==="compactPrompt"?(ko?"압축 프롬프트":"Compacting prompt"):prompt==="resumePrompt"?(ko?"재개 프롬프트":"Resume prompt"):prompt==="hostCommandAnalysisPrompt"?(ko?"셸 명령 위험도 분석 프롬프트":"Shell-command risk analysis prompt"):(ko?"제목 생성 프롬프트":"Title prompt")} help={prompt==="resumePrompt"?(ko?"출력을 재개할 때 사용합니다. %COMPRESSED%는 압축된 맥락으로, %USER_PROMPT%는 원래 사용자 메시지로 치환됩니다.":"Used when resuming an interrupted response. %COMPRESSED% is replaced with the compacted context and %USER_PROMPT% with the original user message."):prompt==="hostCommandAnalysisPrompt"?(ko?"채팅 맥락과 분리된 요청의 시스템 프롬프트입니다. JSON 위험도와 투명한 설명을 요구해야 합니다.":"System prompt for the context-isolated request. It must require JSON risk and a transparent explanation."):undefined} value={h[prompt]} multiline onClose={()=>setPrompt(null)} onSave={text=>{patch({[prompt]:text});setPrompt(null);}}/>}
  </div>;
}
