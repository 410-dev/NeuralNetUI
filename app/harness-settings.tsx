"use client";
import { useState } from "react";
import { createPortal } from "react-dom";
import { X, Pencil, Check, Layers, Type, RotateCw, Minimize2, Clock, Zap } from "lucide-react";
import type { HarnessSettings, PublicConfig } from "@/lib/types";
import { DEFAULT_HARNESS_SETTINGS } from "@/lib/harness";
import { useModalFocus } from "@/lib/use-modal-focus";
import { SectionTitle } from "./section-title";
import { SelectMenu } from "./select-menu";

const EFFORT_LABELS: Record<string, [string, string]> = {
  off: ["Off", "사용 안 함"], on: ["Thinking", "사고 사용"], minimal: ["Minimal", "최소"],
  low: ["Low", "낮음"], medium: ["Medium", "보통"], high: ["High", "높음"], xhigh: ["Extra high", "매우 높음"],
};

export function TextDialog({ title, value, onSave, onClose, multiline = false }: { title:string; value:string; onSave:(value:string)=>void; onClose:()=>void; multiline?:boolean }) {
  const [text,setText] = useState(value);
  const ref = useModalFocus(onClose);
  return createPortal(<div ref={ref} tabIndex={-1} className="harness-modal-layer" role="dialog" aria-modal="true" aria-label={title}><button className="settings-backdrop" tabIndex={-1} onClick={onClose} aria-label="Close"/><form className="harness-dialog" onSubmit={e=>{e.preventDefault();if(text.trim())onSave(text.trim());}}><header><h2>{title}</h2><button type="button" onClick={onClose} aria-label="Close"><X size={20}/></button></header>{multiline ? <textarea aria-label={title} rows={16} maxLength={32000} value={text} onChange={e=>setText(e.target.value)}/> : <input aria-label={title} maxLength={200} value={text} onChange={e=>setText(e.target.value)}/>}<button className="save-button" disabled={!text.trim()}>OK</button></form></div>,document.body);
}

// Radio cards keep the harness modes and title timings comparable at a glance.
function OptionCards({ label, options, value, onSelect }: { label:string; options:Array<{ id:string; icon:React.ReactNode; title:string; description:string }>; value:string; onSelect:(id:string)=>void }) {
  return <div className="option-cards" role="radiogroup" aria-label={label}>{options.map(option => <button key={option.id} type="button" role="radio" aria-checked={value===option.id} className={value===option.id ? "active" : ""} onClick={()=>onSelect(option.id)}><span className="option-card-icon">{option.icon}</span><div><strong>{option.title}</strong><small>{option.description}</small></div>{value===option.id && <Check size={16}/>}</button>)}</div>;
}

export function HarnessSettingsPanel({draft,setDraft}: {draft:PublicConfig;setDraft:React.Dispatch<React.SetStateAction<PublicConfig>>}) {
  const ko=draft.preferences.language==="ko";
  const h=draft.harnessSettings || DEFAULT_HARNESS_SETTINGS;
  const [prompt,setPrompt]=useState<"compactPrompt"|"titlePrompt"|null>(null);
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
        <button type="button" className="subtle-action" onClick={()=>setPrompt("compactPrompt")}><Pencil size={16}/>{ko?"압축 프롬프트 편집":"Edit compacting prompt"}</button>
      </div>}
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
    {prompt&&<TextDialog title={prompt==="compactPrompt"?(ko?"압축 프롬프트":"Compacting prompt"):(ko?"제목 생성 프롬프트":"Title prompt")} value={h[prompt]} multiline onClose={()=>setPrompt(null)} onSave={text=>{patch({[prompt]:text});setPrompt(null);}}/>}
  </div>;
}
