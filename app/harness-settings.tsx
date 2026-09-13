"use client";
import { useState } from "react";
import { createPortal } from "react-dom";
import { X, Pencil, Check, Layers, Type, RotateCw, Minimize2, Clock, Zap, ShieldCheck, ShieldQuestion, ShieldX, Grid3X3 } from "lucide-react";
import type { HarnessSettings, PublicConfig } from "@/lib/types";
import { DEFAULT_HARNESS_SETTINGS } from "@/lib/harness";
import { HOST_PERMISSION_DEFINITIONS, type HostPermissionKey, type HostTrustedPermissions } from "@/lib/host-permissions";
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

function PermissionMatrixDialog({ ko, initial, onSave, onClose }: { ko:boolean; initial:HostTrustedPermissions; onSave:(value:HostTrustedPermissions)=>void; onClose:()=>void }) {
  const [permissions,setPermissions]=useState<HostTrustedPermissions>(()=>({...initial}));
  const ref=useModalFocus(onClose);
  const riskByKey=new Map(HOST_PERMISSION_DEFINITIONS.map(item=>[item.key,item.riskLevel]));
  const groups:Array<{title:string;rows:Array<{key:HostPermissionKey;title:string;detail:string}>}>=[
    {title:ko?"파일":"Files",rows:[
      {key:"files.search",title:ko?"파일 검색":"Search files",detail:ko?"이름과 경로, 메타데이터만 검색":"Search names, paths, and metadata only"},
      {key:"files.inspect",title:ko?"경로 정보 확인":"Inspect path",detail:ko?"종류, 크기, 수정 시각, 권한 확인":"Inspect type, size, modified time, and permissions"},
      {key:"files.read",title:ko?"파일 내용 읽기":"Read file contents",detail:ko?"실제 파일 내용을 읽음":"Read the actual contents of a file"},
      {key:"files.copy",title:ko?"파일·폴더 복사":"Copy files or folders",detail:ko?"기존 대상은 덮어쓰지 않음":"Do not replace an existing destination"},
      {key:"files.copyOverwrite",title:ko?"복사하며 덮어쓰기":"Copy and overwrite",detail:ko?"기존 대상을 복사본으로 교체":"Replace an existing destination with the copy"},
      {key:"files.write",title:ko?"새 파일 쓰기":"Write a new file",detail:ko?"새 파일을 생성하고 내용을 기록":"Create a file and write its contents"},
      {key:"files.writeOverwrite",title:ko?"파일 내용 덮어쓰기":"Overwrite file contents",detail:ko?"기존 파일 내용을 원자적으로 교체":"Atomically replace existing file contents"},
      {key:"files.rename",title:ko?"이름 바꾸기":"Rename",detail:ko?"같은 폴더 안에서 이름 변경":"Change a name within the same folder"},
      {key:"files.move",title:ko?"파일·폴더 이동":"Move files or folders",detail:ko?"기존 대상은 덮어쓰지 않음":"Do not replace an existing destination"},
      {key:"files.moveOverwrite",title:ko?"이동하며 덮어쓰기":"Move and overwrite",detail:ko?"기존 대상을 영구 교체":"Permanently replace an existing destination"},
      {key:"files.delete",title:ko?"단일 경로 삭제":"Delete one path",detail:ko?"파일 또는 빈 폴더를 영구 삭제":"Permanently delete a file or empty folder"},
      {key:"files.deleteRecursive",title:ko?"재귀 삭제":"Recursive delete",detail:ko?"폴더와 모든 하위 항목을 영구 삭제":"Permanently delete a folder and everything below it"},
    ]},
    {title:ko?"업로드":"Upload",rows:[
      {key:"network.uploadTemp",title:ko?"임시 파일 업로드":"Temporary file upload",detail:ko?"파일을 temp.hysong.dev로 전송":"Send a file to temp.hysong.dev"},
    ]},
    {title:ko?"백그라운드 프로그램":"Background programs",rows:[
      {key:"process.start",title:ko?"프로그램 시작":"Start program",detail:ko?"PID와 이름을 현재 채팅에 보관":"Retain its PID and name in this chat"},
      {key:"process.list",title:ko?"프로그램 목록 확인":"List programs",detail:ko?"이 채팅에서 시작한 프로세스만 확인":"List only processes started in this chat"},
      {key:"process.kill",title:ko?"프로그램 종료":"Stop program",detail:ko?"이 채팅에서 기록한 PID를 종료":"Terminate a PID retained by this chat"},
    ]},
    {title:"PowerShell",rows:([1,2,3,4,5] as const).map(level=>({key:`powershell.risk${level}` as HostPermissionKey,title:ko?`위험도 ${level} 명령`:`Risk level ${level} commands`,detail:ko?"독립 분석기가 이 단계로 분류한 PowerShell 실행":`PowerShell runs classified at this level by the isolated assessor`}))},
    {title:"Bash",rows:([1,2,3,4,5] as const).map(level=>({key:`bash.risk${level}` as HostPermissionKey,title:ko?`위험도 ${level} 명령`:`Risk level ${level} commands`,detail:ko?"독립 분석기가 이 단계로 분류한 Bash 실행":`Bash runs classified at this level by the isolated assessor`}))},
    {title:ko?"화면":"Screen",rows:[
      {key:"screen.screenshot",title:ko?"현재 화면 캡처":"Capture current screen",detail:ko?"전체 화면을 모델의 시각 맥락으로 전달":"Provide the full screen as visual model context"},
    ]},
  ];
  const setAll=(value:boolean)=>setPermissions(Object.fromEntries(HOST_PERMISSION_DEFINITIONS.map(({key})=>[key,value])) as HostTrustedPermissions);
  const trusted=Object.values(permissions).filter(Boolean).length;
  return createPortal(<div ref={ref} tabIndex={-1} className="harness-modal-layer permission-matrix-layer" role="dialog" aria-modal="true" aria-label={ko?"컴퓨터 제어 권한 행렬":"Computer-control permission matrix"}>
    <button className="settings-backdrop" tabIndex={-1} onClick={onClose} aria-label={ko?"닫기":"Close"}/>
    <div className="harness-dialog permission-matrix-dialog">
      <header><div><h2>{ko?"컴퓨터 제어 권한 행렬":"Computer-control permission matrix"}</h2><p>{ko?"부분 신뢰에서 확인 없이 실행할 작업을 하위 기능별로 선택합니다.":"Choose which sub-tool operations may run without confirmation in partial trust mode."}</p></div><button type="button" onClick={onClose} aria-label={ko?"닫기":"Close"}><X size={20}/></button></header>
      <div className="permission-matrix-toolbar"><span>{ko?`${trusted}/${HOST_PERMISSION_DEFINITIONS.length}개 작업 자동 허용`:`${trusted} of ${HOST_PERMISSION_DEFINITIONS.length} operations auto-allowed`}</span><div><button type="button" className="subtle-action" onClick={()=>setAll(true)}>{ko?"모두 자동 허용":"Auto-allow all"}</button><button type="button" className="subtle-action" onClick={()=>setAll(false)}>{ko?"모두 확인":"Ask for all"}</button></div></div>
      <div className="permission-matrix" role="table" aria-label={ko?"작업별 권한":"Per-operation permissions"}>
        <div className="permission-matrix-head" role="row"><span role="columnheader">{ko?"하위 도구 및 작업":"Sub-tool and operation"}</span><span role="columnheader">{ko?"자동 허용":"Auto-allow"}</span><span role="columnheader">{ko?"매번 확인":"Always ask"}</span></div>
        {groups.map(group=><section key={group.title} className="permission-matrix-group"><h3>{group.title}</h3>{group.rows.map(row=>{const allowed=permissions[row.key]===true;return <div className="permission-matrix-row" role="row" key={row.key}>
          <div role="cell"><strong>{row.title}</strong><small><span>{ko?`위험도 ${riskByKey.get(row.key)}`:`Risk ${riskByKey.get(row.key)}`}</span>{row.detail}</small></div>
          <button type="button" role="radio" aria-checked={allowed} aria-label={`${row.title} · ${ko?"자동 허용":"Auto-allow"}`} className={allowed?"active":""} onClick={()=>setPermissions(current=>({...current,[row.key]:true}))}><i/></button>
          <button type="button" role="radio" aria-checked={!allowed} aria-label={`${row.title} · ${ko?"매번 확인":"Always ask"}`} className={!allowed?"active":""} onClick={()=>setPermissions(current=>({...current,[row.key]:false}))}><i/></button>
        </div>})}</section>)}
      </div>
      <footer><button type="button" className="secondary-button" onClick={onClose}>{ko?"취소":"Cancel"}</button><button type="button" className="save-button" onClick={()=>onSave(permissions)}>{ko?"행렬 적용":"Apply matrix"}</button></footer>
    </div>
  </div>,document.body);
}

export function HarnessSettingsPanel({draft,setDraft}: {draft:PublicConfig;setDraft:React.Dispatch<React.SetStateAction<PublicConfig>>}) {
  const ko=draft.preferences.language==="ko";
  const h=draft.harnessSettings || DEFAULT_HARNESS_SETTINGS;
  const [prompt,setPrompt]=useState<"compactPrompt"|"resumePrompt"|"titlePrompt"|"hostCommandAnalysisPrompt"|null>(null);
  const [permissionMatrix,setPermissionMatrix]=useState(false);
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
        { id:"partial", icon:<ShieldQuestion size={17}/>, title:ko?"부분 신뢰":"Partial trust", description:ko?"권한 행렬에서 선택한 하위 작업만 자동 허용합니다.":"Auto-allow only sub-tool operations selected in the matrix." },
        { id:"none", icon:<ShieldX size={17}/>, title:ko?"신뢰 안 함":"No trust", description:ko?"모든 호스트 작업을 매번 확인합니다.":"Confirm every host action." },
      ]}/>
      {h.hostTrustMode==="partial" && <div className="harness-advanced host-permission-summary"><h4>{ko?"작업별 자동 허용":"Per-operation auto-approval"}</h4><div><span><strong>{Object.values(h.hostTrustedPermissions).filter(Boolean).length}</strong> / {HOST_PERMISSION_DEFINITIONS.length}</span><small>{ko?"개 하위 작업을 확인 없이 실행하도록 설정했습니다.":"sub-tool operations may run without confirmation."}</small></div><button type="button" className="subtle-action" onClick={()=>setPermissionMatrix(true)}><Grid3X3 size={16}/>{ko?"권한 행렬 열기":"Open permission matrix"}</button></div>}
      <div className="harness-advanced"><h4>{ko?"독립 셸 명령 분석":"Isolated shell-command analysis"}</h4><div className="form-grid">
        <label className="field"><span>{ko?"분석 모델":"Assessment model"}</span><SelectMenu label={ko?"분석 모델":"Assessment model"} value={h.hostCommandModelId} options={[{value:"",label:ko?"현재 채팅의 기반 모델":"Current chat's base model"},...draft.models.filter(m=>!m.isAlias&&m.visible!==false).map(m=>({value:m.id,label:m.name}))]} onChange={value=>patch({hostCommandModelId:value,hostCommandEffort:"off"})}/><small>{ko?"명령어만 포함하는 별도 요청이며 채팅 기록을 전달하지 않습니다.":"This separate request contains only the command, never chat history."}</small></label>
        <label className="field"><span>{ko?"추론 강도":"Reasoning effort"}</span><SelectMenu label={ko?"추론 강도":"Reasoning effort"} value={h.hostCommandEffort} options={[...new Set(["off",...(draft.models.find(m=>m.id===h.hostCommandModelId)?.reasoningEfforts||["on","minimal","low","medium","high","xhigh"])])].map(value=>({value,label:effortLabel(value)}))} onChange={value=>patch({hostCommandEffort:value})}/></label>
      </div><button type="button" className="subtle-action" onClick={()=>setPrompt("hostCommandAnalysisPrompt")}><Pencil size={16}/>{ko?"위험도 분석 프롬프트 편집":"Edit risk-analysis prompt"}</button></div>
    </section>}
    {prompt&&<TextDialog title={prompt==="compactPrompt"?(ko?"압축 프롬프트":"Compacting prompt"):prompt==="resumePrompt"?(ko?"재개 프롬프트":"Resume prompt"):prompt==="hostCommandAnalysisPrompt"?(ko?"셸 명령 위험도 분석 프롬프트":"Shell-command risk analysis prompt"):(ko?"제목 생성 프롬프트":"Title prompt")} help={prompt==="resumePrompt"?(ko?"출력을 재개할 때 사용합니다. %COMPRESSED%는 압축된 맥락으로, %USER_PROMPT%는 원래 사용자 메시지로 치환됩니다.":"Used when resuming an interrupted response. %COMPRESSED% is replaced with the compacted context and %USER_PROMPT% with the original user message."):prompt==="hostCommandAnalysisPrompt"?(ko?"채팅 맥락과 분리된 요청의 시스템 프롬프트입니다. JSON 위험도와 투명한 설명을 요구해야 합니다.":"System prompt for the context-isolated request. It must require JSON risk and a transparent explanation."):undefined} value={h[prompt]} multiline onClose={()=>setPrompt(null)} onSave={text=>{patch({[prompt]:text});setPrompt(null);}}/>}
    {permissionMatrix&&<PermissionMatrixDialog ko={ko} initial={h.hostTrustedPermissions} onClose={()=>setPermissionMatrix(false)} onSave={value=>{patch({hostTrustedPermissions:value});setPermissionMatrix(false);}}/>}
  </div>;
}
