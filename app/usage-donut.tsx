"use client";
import { ChevronDown, RefreshCw, RotateCcw, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { UsageStatus } from "@/lib/types";
import type { LmfAgyQuota, LmfQuotaTarget, LmfQuotaWindow } from "@/lib/lmf";
import { foldedQuotaWindows, quotaPressure } from "@/lib/lmf-quota";
import { USAGE_REFRESH_EVENT, usageLevel, usagePopoverPlacement } from "@/lib/usage-popover";
const scopeLabels={ko:{input:"입력",output:"출력",both:"입력 + 출력"},en:{input:"Input",output:"Output",both:"Input + output"}} as const;
const clamp=(value:number)=>Math.min(100,Math.max(0,value||0));
function stamp(value:string,ko:boolean){return new Date(value).toLocaleString(ko?"ko-KR":"en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});}
function duration(seconds:number,ko:boolean){const hours=seconds/3600;return hours>=24&&hours%24===0?`${hours/24}${ko?"일":"d"}`:`${hours}${ko?"시간":"h"}`;}
type LmfUsageSection={id:string;name:string;targets:LmfQuotaTarget[];error?:string};
/** Antigravity windows per section and target key, fetched apart from the route status (see /api/lmf/agy-quota). */
type AgyQuotaSections=Record<string,Record<string,LmfAgyQuota>>;
function windowName(window:LmfQuotaWindow,ko:boolean){if(window.windowSeconds)return duration(window.windowSeconds,ko);return window.name.replace(/_/g," ");}
function ago(value:string,ko:boolean){const minutes=Math.max(0,Math.round((Date.now()-Date.parse(value))/60_000));if(minutes<1)return ko?"방금":"just now";if(minutes<60)return ko?`${minutes}분 전`:`${minutes} min ago`;const hours=Math.round(minutes/60);return hours<48?(ko?`${hours}시간 전`:`${hours} h ago`):(ko?`${Math.round(hours/24)}일 전`:`${Math.round(hours/24)} d ago`);}
function QuotaRow({window,ko}:{window:LmfQuotaWindow;ko:boolean}){
  const left=clamp(100-window.usedPercent);const limit=window.thresholdPercent;
  const notes=[window.resetsAt&&(Date.parse(window.resetsAt)<=Date.now()?(ko?"초기화됨":"Reset"):ko?`${stamp(window.resetsAt,ko)} 초기화`:`Resets ${stamp(window.resetsAt,ko)}`),window.observedAt&&(ko?`${ago(window.observedAt,ko)} 기준`:`as of ${ago(window.observedAt,ko)}`)].filter(Boolean).join(" · ");
  return <div className="usage-lmf-item" data-level={usageLevel(quotaPressure(window))} title={limit?(ko?`사용량이 ${limit}%에 이르면 라우팅이 다음 대상으로 넘어갑니다`:`Routing moves on at ${limit}% used`):undefined}>
    <span>{windowName(window,ko)}{window.source==="config"?(ko?" · 자체 한도":" · own limit"):""}</span><b>{ko?`${Math.round(left)}% 남음`:`${Math.round(left)}% left`}</b>
    <i role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(left)}><em style={{width:`${left}%`}}/>{limit!==undefined&&limit<100&&<s style={{left:`${100-limit}%`}}/>}</i>
    {notes&&<small>{notes}</small>}
  </div>;
}
/**
 * One routing target: folded, only the window closest to its limit; unfolded, every window from the shortest to the
 * longest, so shorter windows open above the folded one (pushing it down) and longer ones below it. With `showAll`
 * (Appearance → "Show every window") there is nothing to fold: every window is listed.
 */
function QuotaTarget({target,ko,showAll}:{target:LmfQuotaTarget;ko:boolean;showAll:boolean}){
  const [toggled,setOpen]=useState(false);
  const open=showAll||toggled;
  const {ordered,primary}=foldedQuotaWindows(target.windows);
  const foldable=!showAll&&ordered.length>1;
  const name=<>{target.position?`${target.position}. `:""}{target.label}{!target.available&&<em>{ko?"사용 중지":"paused"}</em>}</>;
  return <div className="usage-lmf-target" data-available={target.available}>
    {foldable?<button type="button" className="usage-lmf-name" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>{name}<ChevronDown size={13} className="usage-lmf-chevron"/></button>:<span className="usage-lmf-name">{name}</span>}
    {ordered.length?<div className="usage-lmf-windows">{ordered.map((window,index)=><div key={window.name} className="usage-lmf-fold" data-open={index===primary||open} aria-hidden={index!==primary&&!open}><div><QuotaRow window={window} ko={ko}/></div></div>)}</div>:<p>{ko?"조회 안됨":"Not available"}</p>}
  </div>;
}
/** Remaining provider quota of each LMFuseFramework routing target; providers that report none read "not available". */
function LmfUsage({sections,agy,ko,showAll}:{sections:LmfUsageSection[];agy:AgyQuotaSections;ko:boolean;showAll:boolean}){
  if(!sections.length)return null;
  // Antigravity reports no windows in the route status; its TUI reading (fetched separately) fills them in.
  const merged=(section:LmfUsageSection,target:LmfQuotaTarget):LmfQuotaTarget=>{const extra=agy[section.id]?.[target.key]?.windows;return extra?.length?{...target,windows:[...extra,...target.windows.filter(window=>!extra.some(item=>item.name===window.name))]}:target;};
  return <div className="usage-lmf-list"><strong>{ko?"LMF 라우팅 대상 남은 사용량":"LMF routing targets: remaining quota"}</strong>
    {sections.map(section=><section key={section.id}>{sections.length>1&&<span className="usage-lmf-section">{section.name}</span>}
      {section.error?<p>{ko?"LMF 서버에서 조회하지 못했습니다":"Could not reach the LMF server"}</p>:section.targets.map(target=><QuotaTarget key={target.key} target={merged(section,target)} ko={ko} showAll={showAll}/>)}
    </section>)}
  </div>;
}
export function UsageDonut({ko,collapsed,showAllQuotaWindows=false}:{ko:boolean;collapsed:boolean;showAllQuotaWindows?:boolean}){
  const [data,setData]=useState<UsageStatus>();
  const [open,setOpen]=useState(false);
  const [busy,setBusy]=useState("");
  const [placement,setPlacement]=useState<React.CSSProperties>();
  const buttonRef=useRef<HTMLButtonElement>(null);
  const wrapRef=useRef<HTMLDivElement>(null);
  const [refreshing,setRefreshing]=useState(false);
  const [lmf,setLmf]=useState<LmfUsageSection[]>([]);
  const [agy,setAgy]=useState<AgyQuotaSections>({});
  // The refresh button asks LMF to read each account's quota afresh (POST); the minute timer only reads what it has.
  const loadLmf=(refresh=false)=>fetch("/api/lmf/usage",{method:refresh?"POST":"GET",cache:"no-store"}).then(response=>response.ok?response.json():undefined).then(next=>{if(next?.sections)setLmf(next.sections);}).catch(()=>undefined);
  // Antigravity quota is its own request: LMF reads it from the agy TUI, which is slow and may fail without holding up
  // or breaking the other providers' windows. A section whose reading failed keeps what it showed before.
  const loadAgy=(refresh=false)=>fetch("/api/lmf/agy-quota",{method:refresh?"POST":"GET",cache:"no-store"}).then(response=>response.ok?response.json():undefined).then(next=>{
    if(!Array.isArray(next?.sections))return;
    setAgy(current=>{const out={...current};for(const section of next.sections as Array<{id:string;targets:LmfAgyQuota[];error?:string}>){
      if(section.error)continue;
      const previous=current[section.id]||{};
      out[section.id]=Object.fromEntries(section.targets.map(target=>[target.key,target.error&&previous[target.key]?previous[target.key]:target]));
    }return out;});
  }).catch(()=>undefined);
  const load=()=>fetch("/api/usage",{cache:"no-store"}).then(response=>response.ok?response.json():undefined).then(next=>{if(next)setData(next);}).catch(()=>undefined);
  useEffect(()=>{void load();const timer=window.setInterval(load,60_000);const refresh=()=>void load();window.addEventListener(USAGE_REFRESH_EVENT,refresh);return()=>{window.clearInterval(timer);window.removeEventListener(USAGE_REFRESH_EVENT,refresh);};},[]);
  useEffect(()=>{if(!open)return;void loadLmf();void loadAgy();const timer=window.setInterval(()=>{void loadLmf();void loadAgy();},60_000);return()=>window.clearInterval(timer);},[open]);
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
  async function refresh(){if(refreshing)return;setRefreshing(true);try{await Promise.all([load(),loadLmf(true),loadAgy(true)]);}finally{setRefreshing(false);}}
  async function redeem(id:string){setBusy(id);try{const response=await fetch("/api/usage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({creditId:id})});if(response.ok)setData(await response.json());}finally{setBusy("");}}
  return <div ref={wrapRef} className="usage-donut-wrap"><button ref={buttonRef} className="usage-donut-button" title={ko?"플랜 사용량":"Plan usage"} aria-label={ko?"플랜 사용량":"Plan usage"} aria-expanded={open} aria-haspopup="dialog" onClick={event=>{event.stopPropagation();setOpen(value=>!value);}}><span className="usage-donut" data-level={usageLevel(data.nearestPercentage)} style={{"--usage-fill":`${clamp(data.nearestPercentage)*3.6}deg`} as React.CSSProperties}/></button>{open&&placement&&<div className="usage-popover" role="dialog" aria-label={ko?"플랜 사용량":"Plan usage"} style={placement}><header><div><strong>{data.plan.name}</strong><small>{ko?"사용 구간별 한도 대비 사용률":"Usage against each window limit"}</small></div><div className="usage-popover-actions"><button title={ko?"새로고침":"Refresh"} aria-label={ko?"사용량 새로고침":"Refresh usage"} disabled={refreshing} onClick={()=>void refresh()}><RefreshCw size={14} className={refreshing?"spin":undefined}/></button><button title={ko?"닫기":"Close"} aria-label={ko?"닫기":"Close"} onClick={()=>setOpen(false)}><X size={15}/></button></div></header>{data.windows.length?<div className="usage-window-list">{data.windows.map(window=><div key={window.id} data-level={usageLevel(window.percentage)}><span>{duration(window.durationSeconds,ko)} · {scopeLabels[ko?"ko":"en"][window.tokenScope]}</span><b>{Math.round(clamp(window.percentage))}%</b><i role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamp(window.percentage))}><em style={{width:`${clamp(window.percentage)}%`}}/></i>{window.resetsAt&&<small>{ko?`${stamp(window.resetsAt,ko)} 초기화`:`Resets ${stamp(window.resetsAt,ko)}`}</small>}</div>)}</div>:<p>{ko?"토큰 한도가 없습니다.":"No token limits."}</p>}{data.credits.length>0&&<div className="usage-credit-list"><strong>{ko?"리셋권":"Reset credits"}</strong>{data.credits.map(credit=><button key={credit.id} disabled={busy===credit.id} onClick={()=>void redeem(credit.id)}><RotateCcw size={14}/><span>{credit.title}<small>{duration(credit.maxWindowSeconds,ko)} {ko?"이하 구간 초기화":"windows and shorter"} · {ko?`${stamp(credit.expiresAt,ko)} 만료`:`expires ${stamp(credit.expiresAt,ko)}`}</small></span></button>)}</div>}<LmfUsage sections={lmf} agy={agy} ko={ko} showAll={showAllQuotaWindows}/></div>}</div>;
}
