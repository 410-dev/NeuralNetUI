"use client";

const formatBytes=(bytes:number)=>bytes>=1024**4?`${(bytes/1024**4).toFixed(2)} TB`:bytes>=1024**3?`${(bytes/1024**3).toFixed(2)} GB`:bytes>=1024**2?`${(bytes/1024**2).toFixed(1)} MB`:bytes>=1024?`${(bytes/1024).toFixed(1)} KB`:`${bytes} B`;

export function StorageUsageMeter({used,total,label,ko}:{used:number;total:number;label:string;ko:boolean}){
  const percent=total?Math.min(100,used/total*100):0;const level=percent>=90?"danger":percent>=75?"warning":"normal";
  return <div className="storage-usage-line"><span className="storage-usage-percent" tabIndex={0}>{percent.toFixed(1)}%<span className="storage-usage-tooltip" role="tooltip"><strong>{label}</strong><small>{ko?"사용량":"Used"}<b>{formatBytes(used)}</b></small><small>{ko?"남은 공간":"Remaining"}<b>{formatBytes(Math.max(0,total-used))}</b></small><small>{ko?"전체 공간":"Total"}<b>{formatBytes(total)}</b></small></span></span><i className={level} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(percent.toFixed(1))}><span style={{width:`${percent}%`}}/></i></div>;
}
