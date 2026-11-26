"use client";
import { RefreshCw, RotateCcw, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { UsageStatus } from "@/lib/types";
import type { LmfQuotaTarget, LmfQuotaWindow } from "@/lib/lmf";
import { USAGE_REFRESH_EVENT, usageLevel, usagePopoverPlacement } from "@/lib/usage-popover";
const scopeLabels={ko:{input:"입력",output:"출력",both:"입력 + 출력"},en:{input:"Input",output:"Output",both:"Input + output"}} as const;
const clamp=(value:number)=>Math.min(100,Math.max(0,value||0));
function stamp(value:string,ko:boolean){return new Date(value).toLocaleString(ko?"ko-KR":"en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});}
function duration(seconds:number,ko:boolean){const hours=seconds/3600;return hours>=24&&hours%24===0?`${hours/24}${ko?"일":"d"}`:`${hours}${ko?"시간":"h"}`;}
type LmfUsageSection={id:string;name:string;targets:LmfQuotaTarget[];error?:string};
function windowName(window:LmfQuotaWindow,ko:boolean){if(window.windowSeconds)return duration(window.windowSeconds,ko);return window.name.replace(/_/g," ");}
function ago(value:string,ko:boolean){const minutes=Math.max(0,Math.round((Date.now()-Date.parse(value))/60_000));if(minutes<1)return ko?"방금":"just now";if(minutes<60)return ko?`${minutes}분 전`:`${minutes} min ago`;const hours=Math.round(minutes/60);return hours<48?(ko?`${hours}시간 전`:`${hours} h ago`):(ko?`${Math.round(hours/24)}일 전`:`${Math.round(hours/24)} d ago`);}
/** Remaining provider quota of each LMFuseFramework routing target; providers that report none read "not available". */
function LmfUsage({sections,ko}:{sections:LmfUsageSection[];ko:boolean}){
  if(!sections.length)return null;
  return <div className="usage-lmf-list"><strong>{ko?"LMF 라우팅 대상 남은 사용량":"LMF routing targets: remaining quota"}</strong>{sections.map(section=><section key={section.id}>{sections.length>1&&<span className="usage-lmf-section">{section.name}</span>}{section.error?<p>{ko?"LMF 서버에서 조회하지 못했습니다":"Could not reach the LMF server"}</p>:section.targets.map(target=><div key={target.key} className="usage-lmf-target" data-available={target.available}><span className="usage-lmf-name">{target.position?`${target.position}. `:""}{target.label}{!target.available&&<em>{ko?"사용 중지":"paused"}</em>}</span>{target.windows.length?<div className="usage-window-list">{target.windows.map(window=>{const left=clamp(100-window.usedPercent);const limit=window.thresholdPercent;return <div key={window.name} data-level={usageLevel(limit?window.usedPercent/limit*100:window.usedPercent)} title={limit?(ko?`사용량이 ${limit}%에 이르면 라우팅이 다음 대상으로 넘어갑니다`:`Routing moves on at ${limit}% used`):undefined}><span>{windowName(window,ko)}{window.source==="config"?(ko?" · 자체 한도":" · own limit"):""}</span><b>{ko?`${Math.round(left)}% 남음`:`${Math.round(left)}% left`}</b><i role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(left)}><em style={{width:`${left}%`}}/>{limit!==undefined&&limit<100&&<s style={{left:`${100-limit}%`}}/>}</i><small>{[window.resetsAt&&(ko?`${stamp(window.resetsAt,ko)} 초기화`:`Resets ${stamp(window.resetsAt,ko)}`),window.observedAt&&(ko?`${ago(window.observedAt,ko)} 기준`:`as of ${ago(window.observedAt,ko)}`)].filter(Boolean).join(" · ")}</small></div>;})}</div>:<p>{ko?"조회 안됨":"Not available"}</p>}</div>)}</section>)}</div>;
}
export function UsageDonut({ko,collapsed}:{ko:boolean;collapsed:boolean}){
  const [data,setData]=useState<UsageStatus>();
  const [open,setOpen]=useState(false);
  const [busy,setBusy]=useState("");
  const [placement,setPlacement]=useState<React.CSSProperties>();
  const buttonRef=useRef<HTMLButtonElement>(null);
  const wrapRef=useRef<HTMLDivElement>(null);
  const [refreshing,setRefreshing]=useState(false);
  const [lmf,setLmf]=useState<LmfUsageSection[]>([]);
  const loadLmf=()=>fetch("/api/lmf/usage",{cache:"no-store"}).then(response=>response.ok?response.json():undefined).then(next=>{if(next?.sections)setLmf(next.sections);}).catch(()=>undefined);
  const load=()=>fetch("/api/usage",{cache:"no-store"}).then(response=>response.ok?response.json():undefined).then(next=>{if(next)setData(next);}).catch(()=>undefined);
  useEffect(()=>{void load();const timer=window.setInterval(load,60_000);const refresh=()=>void load();window.addEventListener(USAGE_REFRESH_EVENT,refresh);return()=>{window.clearInterval(timer);window.removeEventListener(USAGE_REFRESH_EVENT,refresh);};},[]);
  useEffect(()=>{if(!open)return;void loadLmf();const timer=window.setInterval(loadLmf,60_000);return()=>window.clearInterval(timer);},[open]);
  useLayoutEffect(()=>{
    if(!open)return;
    const place=()=>{
      const button=buttonRef.current;
      if(!button)return;
      const rect=button.getBoundingClientRect();
      const viewport=window.visualViewport;
      setPlacement(usagePopoverPlacement(
        {width:viewport?.width||window.innerWidth,height:viewport?.height||window.innerHeight},
        {top:rect.top,right:rect.right},
      ));
    };
    place();
    window.addEventListener("resize",place);
    window.visualViewport?.addEventListener("resize",place);
    return()=>{window.removeEventListener("resize",place);window.visualViewport?.removeEventListener("resize",place);};
  },[open,collapsed,data?.windows.length,data?.credits.length,lmf.length]);
  useEffect(()=>{
    if(!open)return;
    const onKey=(event:KeyboardEvent)=>{if(event.key==="Escape"){setOpen(false);buttonRef.current?.focus();}};
    const onPointer=(event:PointerEvent)=>{if(!wrapRef.current?.contains(event.target as Node))setOpen(false);};
    document.addEventListener("keydown",onKey);
    document.addEventListener("pointerdown",onPointer);
    return()=>{document.removeEventListener("keydown",onKey);document.removeEventListener("pointerdown",onPointer);};
  },[open]);
  if(!data?.plan)return null;
  async function refresh(){if(refreshing)return;setRefreshing(true);try{await Promise.all([load(),loadLmf()]);}finally{setRefreshing(false);}}
  async function redeem(id:string){setBusy(id);try{const response=await fetch("/api/usage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({creditId:id})});if(response.ok)setData(await response.json());}finally{setBusy("");}}
  return <div ref={wrapRef} className="usage-donut-wrap"><button ref={buttonRef} className="usage-donut-button" title={ko?"플랜 사용량":"Plan usage"} aria-label={ko?"플랜 사용량":"Plan usage"} aria-expanded={open} aria-haspopup="dialog" onClick={event=>{event.stopPropagation();setOpen(value=>!value);}}><span className="usage-donut" data-level={usageLevel(data.nearestPercentage)} style={{"--usage-fill":`${clamp(data.nearestPercentage)*3.6}deg`} as React.CSSProperties}/></button>{open&&placement&&<div className="usage-popover" role="dialog" aria-label={ko?"플랜 사용량":"Plan usage"} style={placement}><header><div><strong>{data.plan.name}</strong><small>{ko?"사용 구간별 한도 대비 사용률":"Usage against each window limit"}</small></div><div className="usage-popover-actions"><button title={ko?"새로고침":"Refresh"} aria-label={ko?"사용량 새로고침":"Refresh usage"} disabled={refreshing} onClick={()=>void refresh()}><RefreshCw size={14} className={refreshing?"spin":undefined}/></button><button title={ko?"닫기":"Close"} aria-label={ko?"닫기":"Close"} onClick={()=>setOpen(false)}><X size={15}/></button></div></header>{data.windows.length?<div className="usage-window-list">{data.windows.map(window=><div key={window.id} data-level={usageLevel(window.percentage)}><span>{duration(window.durationSeconds,ko)} · {scopeLabels[ko?"ko":"en"][window.tokenScope]}</span><b>{Math.round(clamp(window.percentage))}%</b><i role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamp(window.percentage))}><em style={{width:`${clamp(window.percentage)}%`}}/></i>{window.resetsAt&&<small>{ko?`${stamp(window.resetsAt,ko)} 초기화`:`Resets ${stamp(window.resetsAt,ko)}`}</small>}</div>)}</div>:<p>{ko?"토큰 한도가 없습니다.":"No token limits."}</p>}{data.credits.length>0&&<div className="usage-credit-list"><strong>{ko?"리셋권":"Reset credits"}</strong>{data.credits.map(credit=><button key={credit.id} disabled={busy===credit.id} onClick={()=>void redeem(credit.id)}><RotateCcw size={14}/><span>{credit.title}<small>{duration(credit.maxWindowSeconds,ko)} {ko?"이하 구간 초기화":"windows and shorter"} · {ko?`${stamp(credit.expiresAt,ko)} 만료`:`expires ${stamp(credit.expiresAt,ko)}`}</small></span></button>)}</div>}<LmfUsage sections={lmf} ko={ko}/></div>}</div>;
}
