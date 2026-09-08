"use client";
import { useState } from "react";
import { createPortal } from "react-dom";
import { X, Pencil } from "lucide-react";
import type { HarnessSettings, PublicConfig } from "@/lib/types";
import { DEFAULT_HARNESS_SETTINGS } from "@/lib/harness";
import { useModalFocus } from "@/lib/use-modal-focus";

export function TextDialog({ title, value, onSave, onClose, multiline = false }: { title:string; value:string; onSave:(value:string)=>void; onClose:()=>void; multiline?:boolean }) {
  const [text,setText] = useState(value);
  const ref = useModalFocus(onClose);
  return createPortal(<div ref={ref} tabIndex={-1} className="harness-modal-layer" role="dialog" aria-modal="true" aria-label={title}><button className="settings-backdrop" tabIndex={-1} onClick={onClose} aria-label="Close"/><form className="harness-dialog" onSubmit={e=>{e.preventDefault();if(text.trim())onSave(text.trim());}}><header><h2>{title}</h2><button type="button" onClick={onClose} aria-label="Close"><X size={20}/></button></header>{multiline ? <textarea aria-label={title} rows={16} maxLength={32000} value={text} onChange={e=>setText(e.target.value)}/> : <input aria-label={title} maxLength={200} value={text} onChange={e=>setText(e.target.value)}/>}<button className="save-button" disabled={!text.trim()}>OK</button></form></div>,document.body);
}

export function HarnessSettingsPanel({draft,setDraft}: {draft:PublicConfig;setDraft:React.Dispatch<React.SetStateAction<PublicConfig>>}) {
  const ko=draft.preferences.language==="ko";
  const h=draft.harnessSettings || DEFAULT_HARNESS_SETTINGS;
  const [prompt,setPrompt]=useState<"compactPrompt"|"titlePrompt"|null>(null);
  const patch=(value:Partial<HarnessSettings>)=>setDraft(d=>({...d,harnessSettings:{...(d.harnessSettings || DEFAULT_HARNESS_SETTINGS),...value}}));
  const modelFields=(kind:"compact"|"title")=>{
    const modelKey=kind==="compact"?"compactModelId":"titleModelId";
    const effortKey=kind==="compact"?"compactEffort":"titleEffort";
    const model=draft.models.find(m=>m.id===h[modelKey]);
    const efforts=model?.reasoningEfforts || ["off","on","minimal","low","medium","high","xhigh"];
    return <div className="form-grid"><label className="field"><span>{ko?"사용할 모델":"Model"}</span><select value={h[modelKey]} onChange={e=>patch({[modelKey]:e.target.value,[effortKey]:"off"})}><option value="">{ko?"현재 채팅의 기반 모델":"Current chat's base model"}</option>{draft.models.filter(m=>!m.isAlias && m.visible!==false).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label><label className="field"><span>{ko?"추론 강도":"Reasoning effort"}</span><select value={h[effortKey]} onChange={e=>patch({[effortKey]:e.target.value})}>{[...new Set(["off",...efforts])].map(e=><option key={e} value={e}>{e==="off"?"Off":e}</option>)}</select><small>{ko?"모델이 지원하는 강도만 전달됩니다.":"Only model-supported values are sent."}</small></label></div>;
  };
  return <div className="harness-settings"><section className="settings-section wide"><h3>{ko?"Context window 초과 핸들링":"Context window handling"}</h3><label className="field"><span>{ko?"처리 방식":"Mode"}</span><select value={h.contextMode} onChange={e=>patch({contextMode:e.target.value as HarnessSettings["contextMode"]})}><option value="rolling">{ko?"롤링 (Rolling) — 앞쪽 맥락을 잊음":"Rolling — forget oldest context"}</option><option value="compacting">{ko?"압축 (Compacting) — 대화 요약":"Compacting — summarize conversation"}</option></select></label><p className="settings-help">{ko?"채팅 원문은 모든 분기에 보존됩니다. 컨텍스트 사용량은 모델 전달 내용을 반영합니다. 토큰 수는 서버 사용량이 없으면 추정값입니다.":"Original history is preserved in every branch. Context usage reflects model input, estimated when server usage is unavailable."}</p>{h.contextMode==="compacting"&&<><label className="field"><span>{ko?"압축 시작 임계값 (%)":"Compaction threshold (%)"}</span><input type="number" min={10} max={95} value={h.compactThreshold} onChange={e=>patch({compactThreshold:Number(e.target.value)})}/></label>{modelFields("compact")}<button className="subtle-action" onClick={()=>setPrompt("compactPrompt")}><Pencil size={16}/>{ko?"Compacting 프롬프트 편집":"Edit compacting prompt"}</button></>}</section><section className="settings-section wide"><div className="general-setting-card general-toggle-card"><strong>{ko?"채팅 제목 자동 생성":"Generate chat titles"}</strong><button role="switch" aria-label={ko?"채팅 제목 자동 생성":"Generate chat titles"} aria-checked={h.titleEnabled} className={`toggle ${h.titleEnabled?"on":""}`} onClick={()=>patch({titleEnabled:!h.titleEnabled})}><i/></button></div>{h.titleEnabled&&<><label className="field"><span>{ko?"생성 시점":"Timing"}</span><select value={h.titleTiming} onChange={e=>patch({titleTiming:e.target.value as HarnessSettings["titleTiming"]})}><option value="after">{ko?"모델의 첫 응답 완료 후":"After the first response"}</option><option value="before">{ko?"최초 프롬프트 전송 직후, 응답 전":"Before the first response"}</option></select></label>{modelFields("title")}<button className="subtle-action" onClick={()=>setPrompt("titlePrompt")}><Pencil size={16}/>{ko?"제목 생성 프롬프트 편집":"Edit title prompt"}</button></>}</section>{prompt&&<TextDialog title={prompt==="compactPrompt"?"Compacting prompt":ko?"제목 생성 프롬프트":"Title prompt"} value={h[prompt]} multiline onClose={()=>setPrompt(null)} onSave={text=>{patch({[prompt]:text});setPrompt(null);}}/>}</div>;
}
