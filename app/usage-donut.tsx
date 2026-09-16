"use client";
import { RotateCcw, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { UsageStatus } from "@/lib/types";
import { usagePopoverPlacement } from "@/lib/usage-popover";
const scopeLabels={ko:{input:"입력",output:"출력",both:"입력 + 출력"},en:{input:"Input",output:"Output",both:"Input + output"}} as const;
const clamp=(value:number)=>Math.min(100,Math.max(0,value||0));
function stamp(value:string,ko:boolean){return new Date(value).toLocaleString(ko?"ko-KR":"en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});}
function duration(seconds:number,ko:boolean){const hours=seconds/3600;return hours>=24&&hours%24===0?`${hours/24}${ko?"일":"d"}`:`${hours}${ko?"시간":"h"}`;}
export function UsageDonut({ko,collapsed}:{ko:boolean;collapsed:boolean}){
  const [data,setData]=useState<UsageStatus>();
  const [open,setOpen]=useState(false);
  const [busy,setBusy]=useState("");
  const [placement,setPlacement]=useState<React.CSSProperties>();
  const buttonRef=useRef<HTMLButtonElement>(null);
  const wrapRef=useRef<HTMLDivElement>(null);
  const load=()=>fetch("/api/usage",{cache:"no-store"}).then(response=>response.ok?response.json():undefined).then(setData).catch(()=>undefined);
  useEffect(()=>{void load();const timer=window.setInterval(load,60_000);return()=>window.clearInterval(timer);},[]);
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
  },[open,collapsed,data?.windows.length,data?.credits.length]);
  useEffect(()=>{
    if(!open)return;
    const onKey=(event:KeyboardEvent)=>{if(event.key==="Escape"){setOpen(false);buttonRef.current?.focus();}};
    const onPointer=(event:PointerEvent)=>{if(!wrapRef.current?.contains(event.target as Node))setOpen(false);};
    document.addEventListener("keydown",onKey);
    document.addEventListener("pointerdown",onPointer);
    return()=>{document.removeEventListener("keydown",onKey);document.removeEventListener("pointerdown",onPointer);};
  },[open]);
  if(!data?.plan)return null;
  async function redeem(id:string){setBusy(id);try{const response=await fetch("/api/usage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({creditId:id})});if(response.ok)setData(await response.json());}finally{setBusy("");}}
  return <div ref={wrapRef} className="usage-donut-wrap"><button ref={buttonRef} className="usage-donut-button" title={ko?"플랜 사용량":"Plan usage"} aria-label={ko?"플랜 사용량":"Plan usage"} aria-expanded={open} aria-haspopup="dialog" onClick={event=>{event.stopPropagation();setOpen(value=>!value);}}><span className="usage-donut" style={{"--usage-fill":`${clamp(data.nearestPercentage)*3.6}deg`} as React.CSSProperties}/></button>{open&&placement&&<div className="usage-popover" role="dialog" aria-label={ko?"플랜 사용량":"Plan usage"} style={placement}><header><div><strong>{data.plan.name}</strong><small>{ko?"사용 구간별 한도 대비 사용률":"Usage against each window limit"}</small></div><button title={ko?"닫기":"Close"} aria-label={ko?"닫기":"Close"} onClick={()=>setOpen(false)}><X size={15}/></button></header>{data.windows.length?<div className="usage-window-list">{data.windows.map(window=><div key={window.id}><span>{duration(window.durationSeconds,ko)} · {scopeLabels[ko?"ko":"en"][window.tokenScope]}</span><b>{Math.round(clamp(window.percentage))}%</b><i role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamp(window.percentage))}><em style={{width:`${clamp(window.percentage)}%`}}/></i>{window.resetsAt&&<small>{ko?`${stamp(window.resetsAt,ko)} 초기화`:`Resets ${stamp(window.resetsAt,ko)}`}</small>}</div>)}</div>:<p>{ko?"토큰 한도가 없습니다.":"No token limits."}</p>}{data.credits.length>0&&<div className="usage-credit-list"><strong>{ko?"리셋권":"Reset credits"}</strong>{data.credits.map(credit=><button key={credit.id} disabled={busy===credit.id} onClick={()=>void redeem(credit.id)}><RotateCcw size={14}/><span>{credit.title}<small>{duration(credit.maxWindowSeconds,ko)} {ko?"이하 구간 초기화":"windows and shorter"} · {ko?`${stamp(credit.expiresAt,ko)} 만료`:`expires ${stamp(credit.expiresAt,ko)}`}</small></span></button>)}</div>}</div>}</div>;
}
