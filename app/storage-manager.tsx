"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronLeft, ChevronRight, Download, FileText, HardDrive, LoaderCircle, Search, Trash2, X } from "lucide-react";
import type { StorageFile } from "@/lib/types";
import { useModalFocus } from "@/lib/use-modal-focus";
import { SelectMenu } from "./select-menu";
import { StorageUsageMeter } from "./storage-usage-meter";

type StorageState={quotaBytes:number;usedBytes:number;files:StorageFile[];total:number;page:number;pageCount:number;pageSize:number;sort:string;query:string};
const formatBytes=(bytes:number)=>bytes>=1024**3?`${(bytes/1024**3).toFixed(2)} GB`:bytes>=1024**2?`${(bytes/1024**2).toFixed(1)} MB`:`${Math.max(.1,bytes/1024).toFixed(1)} KB`;

export function StorageManager({ko,onClose,selectMode=false,maxSelectable=1,onSelect}:{ko:boolean;onClose:()=>void;selectMode?:boolean;maxSelectable?:number;onSelect?:(files:StorageFile[])=>void}) {
  const[storage,setStorage]=useState<StorageState>();const[notice,setNotice]=useState("");const[busy,setBusy]=useState("");const[page,setPage]=useState(1);const[sort,setSort]=useState("created_desc");const[query,setQuery]=useState("");const[search,setSearch]=useState("");
  const[selected,setSelected]=useState<Record<string,StorageFile>>({});
  const ref=useModalFocus(onClose);
  useEffect(()=>{const timer=window.setTimeout(()=>{setSearch(query.trim());setPage(1);},180);return()=>window.clearTimeout(timer);},[query]);
  useEffect(()=>{const controller=new AbortController();setStorage(undefined);fetch(`/api/storage?page=${page}&pageSize=24&sort=${encodeURIComponent(sort)}&q=${encodeURIComponent(search)}${selectMode?"&attachable=1":""}`,{cache:"no-store",signal:controller.signal}).then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error);setStorage(body);if(body.page!==page)setPage(body.page);}).catch(error=>{if(error?.name!=="AbortError")setNotice(error instanceof Error?error.message:"Storage could not be loaded.");});return()=>controller.abort();},[page,search,selectMode,sort]);
  async function remove(file:StorageFile){
    if(file.referenceCount||!window.confirm(ko?`“${file.name}” 파일을 삭제할까요?`:`Delete “${file.name}”?`))return;
    setBusy(file.id);setNotice("");try{const response=await fetch("/api/storage",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids:[file.id],page,pageSize:24,sort,query:search})});const body=await response.json();if(!response.ok)throw new Error(body.error);setStorage(body);if(body.page!==page)setPage(body.page);}catch(error){setNotice(error instanceof Error?error.message:"Delete failed.");}finally{setBusy("");}
  }
  const sortOptions=[{value:"created_desc",label:ko?"생성일 · 최신순":"Created · newest"},{value:"created_asc",label:ko?"생성일 · 오래된순":"Created · oldest"},{value:"name_asc",label:ko?"파일명 · 오름차순":"Name · A–Z"},{value:"name_desc",label:ko?"파일명 · 내림차순":"Name · Z–A"},{value:"size_desc",label:ko?"크기 · 큰순":"Size · largest"},{value:"size_asc",label:ko?"크기 · 작은순":"Size · smallest"}];
  const selectedFiles=Object.values(selected);
  function toggle(file:StorageFile){setSelected(current=>{if(current[file.id]){const next={...current};delete next[file.id];return next;}if(Object.keys(current).length>=maxSelectable){setNotice(ko?`최대 ${maxSelectable}개까지 선택할 수 있습니다.`:`You can select up to ${maxSelectable} files.`);return current;}setNotice("");return{...current,[file.id]:file};});}
  return createPortal(<div ref={ref} tabIndex={-1} className="harness-modal-layer storage-manager-layer" role="dialog" aria-modal="true" aria-label={selectMode?(ko?"저장소에서 파일 불러오기":"Choose files from storage"):(ko?"저장소 관리":"Storage manager")}><button className="settings-backdrop" tabIndex={-1} onClick={onClose} aria-label={ko?"닫기":"Close"}/><section className="harness-dialog storage-manager-dialog">
    <header><div><h2>{selectMode?(ko?"저장소에서 파일 불러오기":"Choose files from storage"):(ko?"저장소 관리":"Storage manager")}</h2><p>{selectMode?(ko?"개인 저장소의 이미지 또는 PDF를 현재 메시지에 첨부합니다.":"Attach images or PDFs from your private storage to this message."):(ko?"채팅 첨부 파일과 호스트 도구 스크린샷을 탐색하고 다운로드합니다.":"Browse and download chat attachments and host-tool screenshots.")}</p></div><button onClick={onClose} aria-label={ko?"닫기":"Close"}><X size={20}/></button></header>
    {storage?<div className="storage-meter"><div><HardDrive size={18}/><span><strong>{formatBytes(storage.usedBytes)}</strong> / {formatBytes(storage.quotaBytes)}</span><small>{storage.total} {ko?"개 파일":"files"}</small></div><StorageUsageMeter used={storage.usedBytes} total={storage.quotaBytes} label={ko?"개인 저장소":"Personal storage"} ko={ko}/></div>:<div className="storage-loading"><LoaderCircle className="spin" size={20}/></div>}
    <div className="storage-browser-toolbar"><label><Search size={15}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder={ko?"파일 이름 검색":"Search filenames"}/></label><SelectMenu label={ko?"정렬":"Sort"} value={sort} options={sortOptions} onChange={value=>{setSort(value);setPage(1);}}/></div>
    {notice&&<p className="settings-notice" role="status">{notice}</p>}
    <div className={`storage-file-grid ${selectMode?"selecting":""}`}>{storage?.files.map(file=><article key={file.id} className={selected[file.id]?"selected":""}>
      {selectMode?<button type="button" className="storage-file-preview" aria-pressed={Boolean(selected[file.id])} onClick={()=>toggle(file)}>{file.mimeType.startsWith("image/")?<img src={file.thumbnailUrl||file.url} alt={file.name} loading="lazy"/>:<FileText size={30}/>}<i>{selected[file.id]&&<Check size={16}/>}</i></button>:<a className="storage-file-preview" href={file.url} target="_blank" rel="noreferrer">{file.mimeType.startsWith("image/")?<img src={file.thumbnailUrl||file.url} alt={file.name} loading="lazy"/>:<FileText size={30}/>}</a>}
      <div><strong title={file.name}>{file.name}</strong><small>{formatBytes(file.size)} · {new Date(file.createdAt).toLocaleString(ko?"ko-KR":"en-US")}</small>{file.referenceCount>0&&<em>{ko?`채팅 ${file.referenceCount}곳에서 사용 중`:`Used in ${file.referenceCount} chat message(s)`}</em>}</div>
      {selectMode?<button className="storage-select-file" type="button" onClick={()=>toggle(file)}>{selected[file.id]?(ko?"선택 해제":"Deselect"):(ko?"선택":"Select")}</button>:<span><a href={`${file.url}?download=1`} aria-label={`${ko?"다운로드":"Download"}: ${file.name}`}><Download size={15}/></a><button disabled={busy===file.id||file.referenceCount>0} title={file.referenceCount?(ko?"채팅에서 사용 중인 파일은 삭제할 수 없습니다.":"Files used by chats cannot be deleted."):undefined} onClick={()=>void remove(file)} aria-label={`${ko?"삭제":"Delete"}: ${file.name}`}>{busy===file.id?<LoaderCircle className="spin" size={15}/>:<Trash2 size={15}/>}</button></span>}
    </article>)}{storage&&!storage.files.length&&<p className="storage-empty">{search?(ko?"검색 결과가 없습니다.":"No matching files."):(ko?"저장된 파일이 없습니다.":"No stored files.")}</p>}</div>
    {storage&&<nav className="audit-pager"><button disabled={storage.page<=1} onClick={()=>setPage(storage.page-1)}><ChevronLeft size={16}/></button><span>{storage.page} / {storage.pageCount}<small>{ko?`총 ${storage.total}개`:`${storage.total} total`}</small></span><button disabled={storage.page>=storage.pageCount} onClick={()=>setPage(storage.page+1)}><ChevronRight size={16}/></button></nav>}
    {selectMode&&<footer className="storage-picker-footer"><small>{ko?`${selectedFiles.length}개 선택됨`:`${selectedFiles.length} selected`}</small><button className="save-button" disabled={!selectedFiles.length} onClick={()=>onSelect?.(selectedFiles)}>{ko?"선택한 파일 첨부":"Attach selected files"}</button></footer>}
  </section></div>,document.body);
}
