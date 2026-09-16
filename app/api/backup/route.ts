import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { createBackupImage, restoreBackupImage, type BackupScope } from "@/lib/backup";
import { APP_VERSION } from "@/lib/version";

export const runtime="nodejs";export const dynamic="force-dynamic";const scopes=new Set<BackupScope>(["personal","global","accounts","user"]);
function scopeOf(value:string|null):BackupScope{if(!scopes.has(value as BackupScope))throw Object.assign(new Error("올바른 백업 범위를 선택해 주세요."),{status:400});return value as BackupScope;}
export async function GET(request:Request){try{const actor=requireUser(request);const url=new URL(request.url),scope=scopeOf(url.searchParams.get("scope")||"personal");const image=await createBackupImage(actor,scope,APP_VERSION,url.searchParams.get("userId")||undefined);const stream=createReadStream(image.path);stream.once("close",()=>void image.cleanup());return new Response(Readable.toWeb(stream) as ReadableStream,{headers:{"Content-Type":"application/x-7z-compressed","Content-Disposition":`attachment; filename="${image.name}"`,"Cache-Control":"no-store"}});}catch(error){return authErrorResponse(error);}}
export async function POST(request:Request){let temp="";try{const actor=requireUser(request);const scope=scopeOf(request.headers.get("x-backup-scope")||"personal"),mode=request.headers.get("x-restore-mode")==="replace"?"replace":"merge";const length=Number(request.headers.get("content-length")||0);if(!request.body||length>20*1024**3)throw Object.assign(new Error("백업 이미지가 없거나 허용 크기를 초과했습니다."),{status:413});temp=await mkdtemp(path.join(os.tmpdir(),"neural-upload-"));const archive=path.join(temp,"restore.7z");await pipeline(Readable.fromWeb(request.body as never),createWriteStream(archive,{flags:"wx",mode:0o600}));return Response.json(await restoreBackupImage(actor,archive,scope,mode,request.headers.get("x-target-user-id")||undefined));}catch(error){return authErrorResponse(error);}finally{if(temp)await rm(temp,{recursive:true,force:true}).catch(()=>undefined);}}
