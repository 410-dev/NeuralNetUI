"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { GitBranch, X } from "lucide-react";
import { useModalTransition } from "@/lib/use-modal-focus";

type Result={id:string;title:string;branchId:string;branchName:string;content:string;otherBranch:boolean};
export function HistorySearch({ko,onClose,onSelect}:{ko:boolean;onClose:()=>void;onSelect:(id:string,branch:string)=>void}) {
  const [query,setQuery]=useState(""); const [results,setResults]=useState<Result[]>([]); const [status,setStatus]=useState("");
  const {ref,close,closing}=useModalTransition(onClose);
  useEffect(()=>{
    const controller=new AbortController();setResults([]);setStatus("");
    if(!query.trim())return;
    const timer=setTimeout(async()=>{
      setStatus(ko?"검색 중…":"Searching…");
      try{const response=await fetch(`/api/conversations?q=${encodeURIComponent(query)}`,{signal:controller.signal});if(!response.ok)throw new Error();const data=await response.json();if(!controller.signal.aborted){setResults(data.results);setStatus(data.results.length?"":ko?"검색 결과가 없습니다.":"No results.");}}
      catch{if(!controller.signal.aborted)setStatus(ko?"검색하지 못했습니다.":"Search failed.");}
    },250);
    return()=>{clearTimeout(timer);controller.abort();};
  },[query,ko]);
  return createPortal(<div className={`harness-modal-layer ${closing?"modal-closing":""}`} ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={ko?"채팅 기록 검색":"Search chat history"}><button className="settings-backdrop" tabIndex={-1} onClick={()=>close()} aria-label={ko?"닫기":"Close"}/><section className="harness-dialog"><header><h2>{ko?"채팅 기록 검색":"Search chat history"}</h2><button onClick={()=>close()} aria-label={ko?"닫기":"Close"}><X size={20}/></button></header><input data-autofocus aria-label={ko?"검색어":"Search query"} placeholder={ko?"모든 분기의 채팅 원문 검색…":"Search original messages in all branches…"} value={query} maxLength={200} onChange={e=>setQuery(e.target.value)}/><p role="status">{status}</p><div className="search-results">{results.map(r=><button key={`${r.id}:${r.branchId}`} onClick={()=>close(()=>onSelect(r.id,r.branchId))}><strong>{r.title}{r.otherBranch&&<GitBranch size={16} aria-label={ko?"다른 분기에서 발견":"Match in another branch"}/>}</strong><small>{r.branchName}</small><p>{r.content}</p></button>)}</div></section></div>,document.body);
}
