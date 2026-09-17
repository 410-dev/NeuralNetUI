import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { AuthError, authErrorResponse, requireUser } from "@/lib/auth";
import { createBackupImage, restoreBackupImage, type BackupScope } from "@/lib/backup";
import { validateCredentials } from "@/lib/backup-crypto";
import { Transform } from "node:stream";
import { APP_VERSION } from "@/lib/version";

export const runtime="nodejs";export const dynamic="force-dynamic";const scopes=new Set<BackupScope>(["personal","global","accounts","user"]);
function scopeOf(value:string|null):BackupScope{if(!scopes.has(value as BackupScope))throw Object.assign(new Error("올바른 백업 범위를 선택해 주세요."),{status:400});return value as BackupScope;}
function credentialsOf(request:Request){try{return validateCredentials(JSON.parse(decodeURIComponent(request.headers.get("x-backup-credentials")||"")));}catch{throw Object.assign(new Error("백업 소유자의 아이디와 비밀번호를 입력해 주세요."),{status:400});}}
let activeOperation=false;
function enter(){if(activeOperation)throw new AuthError("다른 백업 또는 복원이 진행 중입니다. 완료 후 다시 시도해 주세요.",409);activeOperation=true;}
export async function GET(request:Request){let entered=false;try{const actor=requireUser(request);const url=new URL(request.url),scope=scopeOf(url.searchParams.get("scope")||"personal");enter();entered=true;const image=await createBackupImage(actor,scope,APP_VERSION,url.searchParams.get("userId")||undefined,credentialsOf(request));const stream=createReadStream(image.path);stream.once("close",()=>void image.cleanup());return new Response(Readable.toWeb(stream) as ReadableStream,{headers:{"Content-Type":"application/octet-stream","Content-Disposition":`attachment; filename="${image.name}"`,"Cache-Control":"no-store"}});}catch(error){return authErrorResponse(error);}finally{if(entered)activeOperation=false;}}
export async function POST(request:Request){let temp="",entered=false;try{const actor=requireUser(request);const scope=scopeOf(request.headers.get("x-backup-scope")||"personal"),mode=request.headers.get("x-restore-mode")==="replace"?"replace":"merge";if(scope!=="personal"&&actor.role!=="admin"&&actor.role!=="superadmin")throw new AuthError("Administrator access required.",403);if(scope==="accounts"&&actor.role!=="superadmin")throw new AuthError("Superadmin access required.",403);const credentials=credentialsOf(request);enter();entered=true;const length=Number(request.headers.get("content-length")||0);if(!request.body||length>20*1024**3)throw Object.assign(new Error("백업 이미지가 없거나 허용 크기를 초과했습니다."),{status:413});temp=await mkdtemp(path.join(os.tmpdir(),"neural-upload-"));const archive=path.join(temp,"restore.nnbak");let received=0;await pipeline(Readable.fromWeb(request.body as never),new Transform({transform(chunk,encoding,callback){received+=chunk.length;callback(received>20*1024**3?Object.assign(new Error("백업 이미지가 허용 크기를 초과했습니다."),{status:413}):null,chunk);}}),createWriteStream(archive,{flags:"wx",mode:0o600}));return Response.json(await restoreBackupImage(actor,archive,scope,mode,request.headers.get("x-target-user-id")||undefined,credentials));}catch(error){return authErrorResponse(error);}finally{if(entered)activeOperation=false;if(temp)await rm(temp,{recursive:true,force:true}).catch(()=>undefined);}}
