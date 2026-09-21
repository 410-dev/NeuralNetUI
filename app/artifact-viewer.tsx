"use client";

import { Check, Code2, Download, FileJson, FileSpreadsheet, Maximize2, PenLine, X } from "lucide-react";
import { ReactNode, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ArtifactDocument, Locale, ToolEvent } from "@/lib/types";
import { useModalFocus } from "@/lib/use-modal-focus";

export function artifactFromEvent(event:ToolEvent):ArtifactDocument|undefined{
  const result=event.result&&typeof event.result==="object"?event.result as Record<string,unknown>:undefined;
  const value=result?.artifact&&typeof result.artifact==="object"?result.artifact as Record<string,unknown>:undefined;
  const kind=String(value?.kind||"");if(!value||!["html","csv","json","xml","markdown"].includes(kind))return undefined;
  return {title:String(value.title||"Artifact"),kind:kind as ArtifactDocument["kind"],content:String(value.content??""),updatedAt:typeof value.updatedAt==="string"?value.updatedAt:undefined};
}

function parseCsv(source:string){
  const rows:string[][]=[];let row:string[]=[],field="",quoted=false;
  for(let i=0;i<=source.length;i++){const char=source[i]??"\n";if(char==='"'){if(quoted&&source[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(char===","&&!quoted){row.push(field);field="";}else if((char==="\n"||char==="\r"&&!quoted)){if(char==="\r"&&source[i+1]==="\n")i++;row.push(field);field="";if(row.some(value=>value.length))rows.push(row);row=[];}else field+=char;}
  return rows.slice(0,2000);
}

function Tree({value,name,depth=0}:{value:unknown;name?:string;depth?:number}):ReactNode{
  if(value===null||typeof value!=="object")return <div className="artifact-tree-leaf">{name&&<b>{name}</b>}<code>{typeof value==="string"?value:JSON.stringify(value)}</code></div>;
  if(depth>=24)return <div className="artifact-tree-leaf">{name&&<b>{name}</b>}<code>…</code></div>;
  const all=Array.isArray(value)?value.map((item,index)=>[String(index),item] as const):Object.entries(value as Record<string,unknown>),entries=all.slice(0,500);
  return <details className="artifact-tree" open={!name}><summary>{name||"root"}<small>{Array.isArray(value)?`${all.length} items`:`${all.length} fields`}</small></summary><div>{entries.map(([key,item])=><Tree key={key} name={key} value={item} depth={depth+1}/>)}{all.length>entries.length&&<div className="artifact-tree-leaf"><b>…</b><code>{all.length-entries.length} more</code></div>}</div></details>;
}

function xmlValue(source:string){
  if(typeof DOMParser==="undefined")return source;
  const document=new DOMParser().parseFromString(source,"application/xml");if(document.querySelector("parsererror"))return {error:"Invalid XML",source};
  const convert=(node:Element,depth=0):unknown=>{if(depth>=24)return "…";const attributes=Object.fromEntries(Array.from(node.attributes).slice(0,100).map(item=>[`@${item.name}`,item.value]));const children=Array.from(node.children).slice(0,500);const text=Array.from(node.childNodes).filter(item=>item.nodeType===Node.TEXT_NODE).map(item=>item.textContent||"").join("").trim();if(!children.length)return Object.keys(attributes).length?{...attributes,...(text?{$text:text}:{})}:text;const grouped:Record<string,unknown>={...attributes};for(const child of children){const converted=convert(child,depth+1);if(child.tagName in grouped)grouped[child.tagName]=Array.isArray(grouped[child.tagName])?[...(grouped[child.tagName] as unknown[]),converted]:[grouped[child.tagName],converted];else grouped[child.tagName]=converted;}if(node.children.length>children.length)grouped.$truncated=`${node.children.length-children.length} more nodes`;if(text)grouped.$text=text;return grouped;};
  return {[document.documentElement.tagName]:convert(document.documentElement)};
}

function ArtifactBody({artifact}:{artifact:ArtifactDocument}){
  if(artifact.kind==="html")return <iframe className="artifact-html-frame" title={artifact.title} sandbox="allow-scripts allow-forms allow-modals allow-popups" srcDoc={artifact.content}/>;
  if(artifact.kind==="markdown")return <div className="artifact-markdown markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]}>{artifact.content}</ReactMarkdown></div>;
  if(artifact.kind==="csv"){const rows=parseCsv(artifact.content),width=Math.min(200,Math.max(0,...rows.map(row=>row.length)));return <div className="artifact-table-wrap"><table><thead><tr>{Array.from({length:width},(_,index)=><th key={index}>{rows[0]?.[index]||`Column ${index+1}`}</th>)}</tr></thead><tbody>{rows.slice(1).map((row,rowIndex)=><tr key={rowIndex}>{Array.from({length:width},(_,index)=><td key={index}>{row[index]||""}</td>)}</tr>)}</tbody></table></div>}
  let value:unknown;try{value=artifact.kind==="json"?JSON.parse(artifact.content):xmlValue(artifact.content);}catch(error){value={error:error instanceof Error?error.message:String(error),source:artifact.content};}return <div className="artifact-structured"><Tree value={value}/></div>;
}

function ArtifactDialog({artifact,locale,onClose,onSave}:{artifact:ArtifactDocument;locale:Locale;onClose:()=>void;onSave?:(next:ArtifactDocument)=>void}){
  const ref=useModalFocus(onClose),[editing,setEditing]=useState(false),[mode,setMode]=useState<"preview"|"code">("preview"),[content,setContent]=useState(artifact.content);
  const draft=useMemo(()=>({...artifact,content}),[artifact,content]);
  function download(){const mime={html:"text/html",csv:"text/csv",json:"application/json",xml:"application/xml",markdown:"text/markdown"}[artifact.kind],extension=artifact.kind==="markdown"?"md":artifact.kind,url=URL.createObjectURL(new Blob([content],{type:`${mime};charset=utf-8`})),anchor=document.createElement("a");anchor.href=url;anchor.download=`${artifact.title.replace(/[\\/:*?\"<>|]/g,"-")}.${extension}`;anchor.click();URL.revokeObjectURL(url);}
  return createPortal(<div ref={ref} tabIndex={-1} className="artifact-layer" role="dialog" aria-modal="true" aria-label={artifact.title}><section className="artifact-dialog"><header><div><Code2 size={18}/><span><strong>{artifact.title}</strong><small>{artifact.kind.toUpperCase()}</small></span></div><nav>{artifact.kind!=="html"&&mode==="preview"&&<button className={editing?"active":""} onClick={()=>setEditing(value=>!value)}><PenLine size={15}/>{locale==="ko"?"수정":"Edit"}</button>}<button onClick={download}><Download size={15}/>{locale==="ko"?"다운로드":"Download"}</button><span className="artifact-view-segments" role="group" aria-label={locale==="ko"?"아티팩트 보기 모드":"Artifact view mode"}><button className={mode==="preview"?"active":""} aria-pressed={mode==="preview"} onClick={()=>setMode("preview")}>{locale==="ko"?"미리보기":"Preview"}</button><button className={mode==="code"?"active":""} aria-pressed={mode==="code"} onClick={()=>{setEditing(false);setMode("code");}}>{locale==="ko"?"코드":"Code"}</button></span><button aria-label={locale==="ko"?"닫기":"Close"} onClick={onClose}><X size={19}/></button></nav></header><div className={`artifact-workspace ${editing&&mode==="preview"?"editing":""}`}>{editing&&artifact.kind!=="html"&&mode==="preview"&&<textarea aria-label={locale==="ko"?"아티팩트 원본":"Artifact source"} value={content} onChange={event=>setContent(event.target.value)}/>}<div className={`artifact-preview ${mode==="code"?"code-mode":""}`}>{mode==="code"?<pre className="artifact-source-view"><code>{content}</code></pre>:<ArtifactBody artifact={draft}/>}</div></div>{editing&&mode==="preview"&&<footer><button className="save-button" onClick={()=>{onSave?.({...draft,updatedAt:new Date().toISOString()});setEditing(false);}}><Check size={15}/>{locale==="ko"?"변경 저장":"Save changes"}</button></footer>}</section></div>,document.body);
}

export function ArtifactCard({event,locale,onSave}:{event:ToolEvent;locale:Locale;onSave?:(artifact:ArtifactDocument)=>void}){
  const initial=artifactFromEvent(event),[open,setOpen]=useState(false),[local,setLocal]=useState(initial);if(!local)return null;
  const Icon=local.kind==="csv"?FileSpreadsheet:local.kind==="json"||local.kind==="xml"?FileJson:Code2;
  return <><article className="artifact-card"><Icon size={20}/><div><strong>{local.title}</strong><small>{local.kind.toUpperCase()} · {locale==="ko"?"대화에서 생성됨":"Created in chat"}</small></div><button onClick={()=>setOpen(true)}>{locale==="ko"?"열기":"Open"}<Maximize2 size={15}/></button></article>{open&&<ArtifactDialog artifact={local} locale={locale} onClose={()=>setOpen(false)} onSave={next=>{setLocal(next);onSave?.(next);}}/>}</>;
}
