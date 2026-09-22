"use client";

import { Check, Code2, Download, FileJson, FileSpreadsheet, FileText, Image as ImageIcon, LoaderCircle, Maximize2, Minimize2, PenLine, X } from "lucide-react";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ArtifactDocument, ArtifactKind, Locale, StorageFile, ToolEvent } from "@/lib/types";
import { storageFileLanguage, storageFileViewKind } from "@/lib/storage-file-view";
import { useModalTransition } from "@/lib/use-modal-focus";
import { SyntaxHighlightedCode } from "./syntax-highlighted-code";

type ViewerKind=ArtifactKind|"text";
type ViewerDocument=Omit<ArtifactDocument,"kind">&{kind:ViewerKind};

export function artifactFromEvent(event:ToolEvent):ArtifactDocument|undefined{
  const result=event.result&&typeof event.result==="object"?event.result as Record<string,unknown>:undefined;
  const value=result?.artifact&&typeof result.artifact==="object"?result.artifact as Record<string,unknown>:undefined;
  const kind=String(value?.kind||"");if(!value||!["html","csv","json","xml","markdown"].includes(kind))return undefined;
  return {title:String(value.title||"Artifact"),kind:kind as ArtifactDocument["kind"],content:String(value.content??""),updatedAt:typeof value.updatedAt==="string"?value.updatedAt:undefined};
}

function artifactStorageFromEvent(event:ToolEvent){
  const result=event.result&&typeof event.result==="object"?event.result as Record<string,unknown>:undefined;
  const value=result?.storage&&typeof result.storage==="object"?result.storage as Record<string,unknown>:undefined;
  if(value?.saved!==true||typeof value.id!=="string"||typeof value.fileName!=="string")return undefined;
  return{id:value.id,fileName:value.fileName,url:typeof value.url==="string"?value.url:`/api/uploads/${value.id}`};
}

function parseCsv(source:string){
  const rows:string[][]=[];let row:string[]=[],field="",quoted=false;
  for(let i=0;i<=source.length;i++){const char=source[i]??"\n";if(char==='"'){if(quoted&&source[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(char===","&&!quoted){row.push(field);field="";}else if((char==="\n"||char==="\r")&&!quoted){if(char==="\r"&&source[i+1]==="\n")i++;row.push(field);field="";if(row.some(value=>value.length))rows.push(row);row=[];}else field+=char;}
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

function ArtifactBody({artifact,language}:{artifact:ViewerDocument;language?:string}){
  if(artifact.kind==="html")return <iframe className="artifact-html-frame" title={artifact.title} sandbox="allow-scripts allow-forms allow-modals allow-popups" srcDoc={artifact.content}/>;
  if(artifact.kind==="markdown")return <div className="artifact-markdown markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]}>{artifact.content}</ReactMarkdown></div>;
  if(artifact.kind==="csv"){const rows=parseCsv(artifact.content),width=Math.min(200,Math.max(0,...rows.map(row=>row.length)));return <div className="artifact-table-wrap"><table><thead><tr>{Array.from({length:width},(_,index)=><th key={index}>{rows[0]?.[index]||`Column ${index+1}`}</th>)}</tr></thead><tbody>{rows.slice(1).map((row,rowIndex)=><tr key={rowIndex}>{Array.from({length:width},(_,index)=><td key={index}>{row[index]||""}</td>)}</tr>)}</tbody></table></div>}
  if(artifact.kind==="text")return <pre className="artifact-source-view"><SyntaxHighlightedCode code={artifact.content} language={language}/></pre>;
  let value:unknown;try{value=artifact.kind==="json"?JSON.parse(artifact.content):xmlValue(artifact.content);}catch(error){value={error:error instanceof Error?error.message:String(error),source:artifact.content};}return <div className="artifact-structured"><Tree value={value}/></div>;
}

function triggerDownload(url:string,name?:string){const anchor=document.createElement("a");anchor.href=url;if(name)anchor.download=name;document.body.append(anchor);anchor.click();anchor.remove();}

export function ArtifactDialog({artifact,locale,onClose,onSave,initialEditing=false,editable=artifact.kind!=="html",downloadUrl,language,loading=false,loadError=""}:{artifact:ViewerDocument;locale:Locale;onClose:()=>void;onSave?:(next:ViewerDocument)=>void|Promise<void>;initialEditing?:boolean;editable?:boolean;downloadUrl?:string;language?:string;loading?:boolean;loadError?:string}){
  const {ref,close,closing}=useModalTransition(onClose),[editing,setEditing]=useState(initialEditing),[mode,setMode]=useState<"preview"|"code">("preview"),[content,setContent]=useState(artifact.content),[maximized,setMaximized]=useState(false),[saving,setSaving]=useState(false),[saveError,setSaveError]=useState("");
  useEffect(()=>setContent(artifact.content),[artifact.content,artifact.kind,artifact.title]);
  const draft=useMemo(()=>({...artifact,content}),[artifact,content]),renderable=artifact.kind!=="text";
  function download(){if(downloadUrl){triggerDownload(downloadUrl);return;}const mime={html:"text/html",csv:"text/csv",json:"application/json",xml:"application/xml",markdown:"text/markdown",text:"text/plain"}[artifact.kind],extension=artifact.kind==="markdown"?"md":artifact.kind,url=URL.createObjectURL(new Blob([content],{type:`${mime};charset=utf-8`}));triggerDownload(url,`${artifact.title.replace(/[\\/:*?\"<>|]/g,"-")}.${extension}`);URL.revokeObjectURL(url);}
  async function save(){if(!onSave||saving)return;setSaving(true);setSaveError("");try{await onSave({...draft,updatedAt:new Date().toISOString()});setEditing(false);}catch(error){setSaveError(error instanceof Error?error.message:(locale==="ko"?"변경 사항을 저장하지 못했습니다.":"Changes could not be saved."));}finally{setSaving(false);}}
  const sizeLabel=maximized?(locale==="ko"?"기본 크기로 복원":"Restore window"):(locale==="ko"?"전체 화면으로 확대":"Maximize");
  return createPortal(<div ref={ref} tabIndex={-1} className={`artifact-layer ${maximized?"maximized":""} ${closing?"modal-closing":""}`} role="dialog" aria-modal="true" aria-label={artifact.title}><button className="settings-backdrop" tabIndex={-1} aria-label={locale==="ko"?"닫기":"Close"} onClick={()=>close()}/><section className="artifact-dialog"><header><div><Code2 size={18}/><span><strong>{artifact.title}</strong><small>{artifact.kind.toUpperCase()}</small></span></div><nav>{editable&&mode==="preview"&&!loading&&!loadError&&<button className={editing?"active":""} aria-pressed={editing} onClick={()=>setEditing(value=>!value)}><PenLine size={15}/>{locale==="ko"?"수정":"Edit"}</button>}<button onClick={download}><Download size={15}/>{locale==="ko"?"다운로드":"Download"}</button>{renderable&&!loading&&!loadError&&<span className="artifact-view-segments" role="group" aria-label={locale==="ko"?"파일 보기 모드":"File view mode"}><button className={mode==="preview"?"active":""} aria-pressed={mode==="preview"} onClick={()=>setMode("preview")}>{locale==="ko"?"렌더":"Render"}</button><button className={mode==="code"?"active":""} aria-pressed={mode==="code"} onClick={()=>{setEditing(false);setMode("code");}}>{locale==="ko"?"원본":"Source"}</button></span>}<button className="artifact-size-toggle" aria-label={sizeLabel} title={sizeLabel} aria-pressed={maximized} onClick={()=>setMaximized(value=>!value)}>{maximized?<Minimize2 size={18}/>:<Maximize2 size={18}/>}</button><button aria-label={locale==="ko"?"닫기":"Close"} onClick={()=>close()}><X size={19}/></button></nav></header>{loading||loadError?<div className={`artifact-load-state ${loadError?"error":""}`}>{loading?<><LoaderCircle className="spin" size={22}/><span>{locale==="ko"?"파일을 불러오는 중…":"Loading file…"}</span></>:<><FileText size={28}/><strong>{locale==="ko"?"파일을 열 수 없습니다.":"The file could not be opened."}</strong><span>{loadError}</span></>}</div>:<div className={`artifact-workspace ${editing&&mode==="preview"?"editing":""} ${editing&&!renderable?"editor-only":""}`}>{editing&&mode==="preview"&&<textarea data-autofocus aria-label={locale==="ko"?"파일 원본":"File source"} value={content} onChange={event=>setContent(event.target.value)}/>} {(renderable||!editing)&&<div className={`artifact-preview ${mode==="code"||!renderable?"code-mode":""}`}>{mode==="code"?<pre className="artifact-source-view"><SyntaxHighlightedCode code={content} language={language||artifact.kind}/></pre>:<ArtifactBody artifact={draft} language={language}/>}</div>}</div>}{editing&&mode==="preview"&&!loading&&!loadError&&<footer>{saveError&&<p className="artifact-save-error" role="alert">{saveError}</p>}<button className="save-button" disabled={saving} onClick={()=>void save()}>{saving?<LoaderCircle className="spin" size={15}/>:<Check size={15}/>} {saving?(locale==="ko"?"저장 중…":"Saving…"):(locale==="ko"?"변경 저장":"Save changes")}</button></footer>}</section></div>,document.body);
}

function StoredMediaDialog({file,locale,kind,onClose}:{file:StorageFile;locale:Locale;kind:"image"|"pdf"|"binary";onClose:()=>void}){
  const {ref,close,closing}=useModalTransition(onClose),[maximized,setMaximized]=useState(false),downloadUrl=`${file.url}${file.url.includes("?")?"&":"?"}download=1`,sizeLabel=maximized?(locale==="ko"?"기본 크기로 복원":"Restore window"):(locale==="ko"?"전체 화면으로 확대":"Maximize");
  return createPortal(<div ref={ref} tabIndex={-1} className={`artifact-layer ${maximized?"maximized":""} ${closing?"modal-closing":""}`} role="dialog" aria-modal="true" aria-label={file.name}><button className="settings-backdrop" tabIndex={-1} aria-label={locale==="ko"?"닫기":"Close"} onClick={()=>close()}/><section className="artifact-dialog"><header><div>{kind==="image"?<ImageIcon size={18}/>:<FileText size={18}/>}<span><strong>{file.name}</strong><small>{file.mimeType}</small></span></div><nav><button onClick={()=>triggerDownload(downloadUrl)}><Download size={15}/>{locale==="ko"?"다운로드":"Download"}</button><button className="artifact-size-toggle" aria-label={sizeLabel} title={sizeLabel} aria-pressed={maximized} onClick={()=>setMaximized(value=>!value)}>{maximized?<Minimize2 size={18}/>:<Maximize2 size={18}/>}</button><button aria-label={locale==="ko"?"닫기":"Close"} onClick={()=>close()}><X size={19}/></button></nav></header><div className="artifact-media-view">{kind==="image"?<img src={file.url} alt={file.name}/>:kind==="pdf"?<iframe src={file.url} title={file.name}/>:<div className="artifact-unsupported"><FileText size={42}/><strong>{locale==="ko"?"이 파일 형식은 브라우저에서 미리 볼 수 없습니다.":"This file type cannot be previewed in the browser."}</strong><span>{locale==="ko"?"원본 파일을 다운로드해 연결된 앱에서 열어 주세요.":"Download the original and open it in a compatible app."}</span><button className="save-button" onClick={()=>triggerDownload(downloadUrl)}><Download size={15}/>{locale==="ko"?"파일 다운로드":"Download file"}</button></div>}</div></section></div>,document.body);
}

export function StorageFileDialog({file,locale,onClose,onUpdated}:{file:StorageFile;locale:Locale;onClose:()=>void;onUpdated?:(file:StorageFile)=>void}){
  const kind=storageFileViewKind(file.name,file.mimeType),textual=!["image","pdf","binary"].includes(kind),[content,setContent]=useState(""),[loading,setLoading]=useState(textual),[loadError,setLoadError]=useState("");
  useEffect(()=>{if(!textual)return;const controller=new AbortController();setLoading(true);setLoadError("");fetch(file.url,{cache:"no-store",signal:controller.signal}).then(async response=>{if(!response.ok)throw new Error(`${response.status} ${response.statusText}`);const data=await response.arrayBuffer();return new TextDecoder("utf-8",{fatal:true}).decode(data);}).then(value=>setContent(value)).catch(error=>{if(error?.name!=="AbortError")setLoadError(error instanceof Error?error.message:String(error));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[file.id,file.url,textual]);
  if(kind==="image"||kind==="pdf"||kind==="binary")return <StoredMediaDialog file={file} locale={locale} kind={kind} onClose={onClose}/>;
  const artifact:ViewerDocument={title:file.name,kind,content};
  return <ArtifactDialog artifact={artifact} locale={locale} onClose={onClose} editable downloadUrl={`${file.url}${file.url.includes("?")?"&":"?"}download=1`} language={storageFileLanguage(file.name,file.mimeType)} loading={loading} loadError={loadError} onSave={async next=>{const response=await fetch(file.url,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({content:next.content})}),body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||`Request failed (${response.status}).`);setContent(next.content);onUpdated?.({...file,...body.attachment});}}/>;
}

export function ArtifactCard({event,locale,onSave}:{event:ToolEvent;locale:Locale;onSave?:(artifact:ArtifactDocument)=>void|Promise<void>}){
  const initial=artifactFromEvent(event),storage=artifactStorageFromEvent(event),[open,setOpen]=useState(false),[local,setLocal]=useState(initial);if(!local)return null;
  const Icon=local.kind==="csv"?FileSpreadsheet:local.kind==="json"||local.kind==="xml"?FileJson:Code2;
  return <><article className="artifact-card"><Icon size={20}/><div><strong>{local.title}</strong><small>{storage?(locale==="ko"?`${storage.fileName} · 저장소에 저장됨`:`${storage.fileName} · Saved to storage`):`${local.kind.toUpperCase()} · ${locale==="ko"?"대화에서 생성됨":"Created in chat"}`}</small></div><button onClick={()=>setOpen(true)}>{locale==="ko"?"열기":"Open"}<Maximize2 size={15}/></button></article>{open&&<ArtifactDialog artifact={local} locale={locale} onClose={()=>setOpen(false)} downloadUrl={storage?`${storage.url}?download=1`:undefined} onSave={async next=>{const artifact=next as ArtifactDocument;if(storage){const response=await fetch(storage.url,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({content:artifact.content})}),body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||`Request failed (${response.status}).`);}await onSave?.(artifact);setLocal(artifact);}}/>}</>;
}
