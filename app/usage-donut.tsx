"use client";
import { RotateCcw, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { UsageStatus } from "@/lib/types";
import { usagePopoverPlacement } from "@/lib/usage-popover";
function duration(seconds:number,ko:boolean){const hours=seconds/3600;return hours>=24&&hours%24===0?`${hours/24}${ko?"일":"d"}`:`${hours}${ko?"시간":"h"}`;}
export function UsageDonut({ko,collapsed}:{ko:boolean;collapsed:boolean}){
  const [data,setData]=useState<UsageStatus>();
  const [open,setOpen]=useState(false);
  const [busy,setBusy]=useState("");
  const [placement,setPlacement]=useState<React.CSSProperties>();
  const buttonRef=useRef<HTMLButtonElement>(null);
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
  if(!data?.plan)return null;
  async function redeem(id:string){setBusy(id);try{const response=await fetch("/api/usage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({creditId:id})});if(response.ok)setData(await response.json());}finally{setBusy("");}}
  return <div className="usage-donut-wrap"><button ref={buttonRef} className="usage-donut-button" title={ko?"플랜 사용량":"Plan usage"} aria-label={ko?"플랜 사용량":"Plan usage"} onClick={event=>{event.stopPropagation();setOpen(value=>!value);}}><span className="usage-donut" style={{"--usage-fill":`${Math.min(100,data.nearestPercentage)*3.6}deg`} as React.CSSProperties}/></button>{open&&placement&&<div className="usage-popover" style={placement}><header><div><strong>{data.plan.name}</strong><small>{ko?"가장 한도에 가까운 구간":"Window nearest its limit"}</small></div><button onClick={()=>setOpen(false)}><X size={15}/></button></header>{data.windows.length?<div className="usage-window-list">{data.windows.map(window=><div key={window.id}><span>{duration(window.durationSeconds,ko)} · {window.tokenScope}</span><b>{Math.round(window.percentage)}%</b><i><em style={{width:`${window.percentage}%`}}/></i></div>)}</div>:<p>{ko?"토큰 한도가 없습니다.":"No token limits."}</p>}{data.credits.length>0&&<div className="usage-credit-list"><strong>{ko?"리셋권":"Reset credits"}</strong>{data.credits.map(credit=><button key={credit.id} disabled={busy===credit.id} onClick={()=>void redeem(credit.id)}><RotateCcw size={14}/><span>{credit.title}<small>{duration(credit.maxWindowSeconds,ko)} {ko?"이하 초기화":"and shorter"}</small></span></button>)}</div>}</div>}</div>;
}
