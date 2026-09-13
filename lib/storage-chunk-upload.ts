import { createReadStream, createWriteStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import type { StoredAttachment } from "./types.ts";
import { dataDir, db } from "./database.ts";
import { readUpload, saveStagedUpload } from "./uploads.ts";

export const STORAGE_UPLOAD_CHUNK_BYTES=8*1024*1024;
const SESSION_TTL_MS=24*60*60*1000;
const stagingRoot=path.join(dataDir,"storage-upload-staging");

type UploadManifest={id:string;userId:string;name:string;size:number;chunkSize:number;totalChunks:number;createdAt:string;completedUploadId?:string};

function assertSessionId(id:string){if(!/^[0-9a-f-]{36}$/i.test(id))throw Object.assign(new Error("Upload session not found."),{code:"ENOENT"});}
const sessionDir=(id:string)=>{assertSessionId(id);return path.join(stagingRoot,id);};
const manifestPath=(id:string)=>path.join(sessionDir(id),"manifest.json");
const chunkPath=(id:string,index:number)=>path.join(sessionDir(id),`chunk-${index}.part`);

async function readManifest(id:string,userId:string){
  let manifest:UploadManifest;try{manifest=JSON.parse(await fs.readFile(manifestPath(id),"utf8")) as UploadManifest;}catch{throw Object.assign(new Error("Upload session not found."),{code:"ENOENT"});}
  const session=db.prepare("SELECT size,completed_upload_id AS completedUploadId FROM storage_upload_sessions WHERE id=? AND user_id=?").get(id,userId) as {size:number;completedUploadId:string|null}|undefined;
  if(manifest.id!==id||manifest.userId!==userId||!session||session.size!==manifest.size)throw Object.assign(new Error("Upload session not found."),{code:"ENOENT"});return{...manifest,...(session.completedUploadId?{completedUploadId:session.completedUploadId}:{})};
}

async function writeManifest(manifest:UploadManifest){const target=manifestPath(manifest.id),temporary=`${target}.${randomUUID()}.tmp`;await fs.writeFile(temporary,JSON.stringify(manifest),{encoding:"utf8",mode:0o600,flag:"wx"});await fs.rename(temporary,target);}

export async function cleanupStorageUploadSessions(now=Date.now()){
  await fs.mkdir(stagingRoot,{recursive:true});let entries:string[]=[];try{entries=await fs.readdir(stagingRoot);}catch{return;}
  await Promise.all(entries.filter(id=>/^[0-9a-f-]{36}$/i.test(id)).map(async id=>{try{const manifest=JSON.parse(await fs.readFile(manifestPath(id),"utf8")) as UploadManifest;if(now-new Date(manifest.createdAt).getTime()>SESSION_TTL_MS)await fs.rm(sessionDir(id),{recursive:true,force:true});}catch{const stat=await fs.stat(sessionDir(id)).catch(()=>undefined);if(stat&&now-stat.mtimeMs>SESSION_TTL_MS)await fs.rm(sessionDir(id),{recursive:true,force:true});}}));
  db.prepare("DELETE FROM storage_upload_sessions WHERE created_at<?").run(new Date(now-SESSION_TTL_MS).toISOString());
}

export async function beginStorageUpload(input:{name?:unknown;size?:unknown},userId:string){
  await cleanupStorageUploadSessions();const name=String(input.name||"").normalize("NFC").replace(/[\u0000-\u001f\u007f]/g,"").replace(/[\\/]+/g,"-").trim().slice(0,240);const size=Number(input.size);
  if(!name||name==="."||name==="..")throw new Error("A valid file name is required.");if(!Number.isSafeInteger(size)||size<0)throw new Error("The file size is not supported.");
  const id=randomUUID(),totalChunks=Math.ceil(size/STORAGE_UPLOAD_CHUNK_BYTES),createdAt=new Date().toISOString();db.transaction(()=>{const account=db.prepare("SELECT storage_quota_bytes AS quota FROM users WHERE id=?").get(userId) as {quota:number}|undefined;if(!account)throw new Error("Storage owner not found.");const used=(db.prepare("SELECT COALESCE(SUM(size),0) AS bytes FROM uploads WHERE user_id=? AND deleted_at IS NULL").get(userId) as {bytes:number}).bytes;const pending=(db.prepare("SELECT COALESCE(SUM(size),0) AS bytes FROM storage_upload_sessions WHERE user_id=? AND completed_upload_id IS NULL").get(userId) as {bytes:number}).bytes;if(used+pending+size>account.quota)throw new Error("The selected file exceeds the remaining storage capacity.");db.prepare("INSERT INTO storage_upload_sessions(id,user_id,size,created_at) VALUES(?,?,?,?)").run(id,userId,size,createdAt);})();
  const manifest:UploadManifest={id,userId,name,size,chunkSize:STORAGE_UPLOAD_CHUNK_BYTES,totalChunks,createdAt};try{await fs.mkdir(sessionDir(id),{recursive:false,mode:0o700});await writeManifest(manifest);return{id,chunkSize:manifest.chunkSize,totalChunks};}catch(error){db.prepare("DELETE FROM storage_upload_sessions WHERE id=? AND user_id=?").run(id,userId);await fs.rm(sessionDir(id),{recursive:true,force:true}).catch(()=>undefined);throw error;}
}

export async function writeStorageUploadChunk(id:string,index:number,userId:string,data:Buffer){
  const manifest=await readManifest(id,userId);if(manifest.completedUploadId)throw new Error("Upload is already complete.");if(!Number.isSafeInteger(index)||index<0||index>=manifest.totalChunks)throw new Error("Invalid upload chunk index.");
  const expected=index===manifest.totalChunks-1?manifest.size-index*manifest.chunkSize:manifest.chunkSize;if(data.length!==expected)throw new Error(`Upload chunk ${index+1} has an invalid size.`);
  const target=chunkPath(id,index);const existing=await fs.stat(target).catch(()=>undefined);if(existing?.isFile()&&existing.size===data.length)return{received:true,index};
  const temporary=`${target}.${randomUUID()}.tmp`;try{await fs.writeFile(temporary,data,{mode:0o600,flag:"wx"});await fs.rename(temporary,target);}finally{await fs.unlink(temporary).catch(()=>undefined);}return{received:true,index};
}

declare global{var neuralStorageUploadLocks:Map<string,Promise<StoredAttachment>>|undefined;}
const completionLocks=globalThis.neuralStorageUploadLocks??new Map<string,Promise<StoredAttachment>>();globalThis.neuralStorageUploadLocks=completionLocks;

export async function completeStorageUpload(id:string,userId:string){
  const existing=completionLocks.get(id);if(existing)return existing;
  const work=(async()=>{const manifest=await readManifest(id,userId);if(manifest.completedUploadId)return(await readUpload(manifest.completedUploadId,userId)).metadata;
    for(let index=0;index<manifest.totalChunks;index++){const stat=await fs.stat(chunkPath(id,index)).catch(()=>undefined);const expected=index===manifest.totalChunks-1?manifest.size-index*manifest.chunkSize:manifest.chunkSize;if(!stat?.isFile()||stat.size!==expected)throw new Error(`Upload chunk ${index+1} is missing.`);}
    const assembled=path.join(sessionDir(id),"assembled.tmp");await fs.unlink(assembled).catch(()=>undefined);await fs.writeFile(assembled,new Uint8Array(),{mode:0o600,flag:"wx"});
    try{for(let index=0;index<manifest.totalChunks;index++)await pipeline(createReadStream(chunkPath(id,index)),createWriteStream(assembled,{flags:"a",mode:0o600}));const stat=await fs.stat(assembled);if(stat.size!==manifest.size)throw new Error("The assembled upload size does not match the source file.");const attachment=await saveStagedUpload(assembled,manifest.name,userId,id);await Promise.all(Array.from({length:manifest.totalChunks},(_,index)=>fs.unlink(chunkPath(id,index)).catch(()=>undefined)));return attachment;}finally{await fs.unlink(assembled).catch(()=>undefined);}
  })();completionLocks.set(id,work);try{return await work;}finally{completionLocks.delete(id);}
}

export async function cancelStorageUpload(id:string,userId:string){await readManifest(id,userId);db.prepare("DELETE FROM storage_upload_sessions WHERE id=? AND user_id=?").run(id,userId);await fs.rm(sessionDir(id),{recursive:true,force:true});}
