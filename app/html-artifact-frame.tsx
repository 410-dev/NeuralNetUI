"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { artifactHtmlWithStorage, artifactStorageEntries } from "@/lib/artifact-html";

export function HtmlArtifactFrame({content,title,enabled,accountId,artifactId,ko,policyError=false}:{content:string;title:string;enabled:boolean;accountId:string;artifactId:string;ko:boolean;policyError?:boolean}){
  const frame=useRef<HTMLIFrameElement>(null),[ready,setReady]=useState(false),[storageError,setStorageError]=useState("");
  const key=`nnui-artifact:${accountId}:${artifactId}`;
  useEffect(()=>{
    if(!enabled){setReady(false);return;}
    const onMessage=(event:MessageEvent)=>{
      if(event.source!==frame.current?.contentWindow||event.data?.type!=="nnui-artifact-storage")return;
      const entries=artifactStorageEntries(event.data.entries);
      if(!entries)return;
      try{localStorage.setItem(key,JSON.stringify(entries));setStorageError("");}
      catch{setStorageError(ko?"아티팩트 Local Storage를 저장할 수 없습니다. 브라우저 저장 공간을 확인해 주세요.":"Artifact Local Storage could not be saved. Check browser storage space.");}
    };
    window.addEventListener("message",onMessage);
    setReady(true);
    return()=>window.removeEventListener("message",onMessage);
  },[enabled,key,ko]);
  const html=useMemo(()=>{
    if(!enabled)return content;
    let entries:Record<string,string>={};
    try{entries=artifactStorageEntries(JSON.parse(localStorage.getItem(key)||"{}"))||{};}
    catch{/* Private browsing can deny the app's storage. The preview still runs in memory. */}
    return artifactHtmlWithStorage(content,entries);
  },[content,enabled,key]);
  return <div className="artifact-html-shell">{!enabled&&<div className="artifact-policy-note">{policyError?(ko?"실행 정책을 확인하지 못해 스크립트를 차단했습니다.":"Scripts were blocked because the execution policy could not be checked."):(ko?"현재 플랜에서 JavaScript와 Local Storage 실행이 꺼져 있습니다.":"JavaScript and Local Storage are disabled for this plan.")}</div>}{storageError&&<div className="artifact-policy-note error" role="alert">{storageError}</div>}{(!enabled||ready)&&<iframe ref={frame} className="artifact-html-frame" title={title} sandbox={enabled?"allow-scripts allow-forms allow-modals allow-popups":"allow-forms allow-modals"} srcDoc={html}/>}</div>;
}
