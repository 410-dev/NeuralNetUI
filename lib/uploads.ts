import { constants, promises as fs, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { assertUploadSignature, extractPdf, isSupportedUploadMimeType, pdfModelContent, sniffRasterMimeType, type ModelContentPart, type PdfExtraction } from "./document-processing.ts";
import type { ArtifactKind, ModelConfig, StorageFile, StoredAttachment, ToolSettings } from "./types.ts";
import { completeStorageMigration, dataDir, db, storageMigrationCompleted } from "./database.ts";
import { resolvedVisionSettings } from "./vision-settings.ts";
import { isEditableStorageFile } from "./storage-file-view.ts";

const uploadsDir = path.join(dataDir, "uploads");
const legacyMigrationName = "legacy-uploads-v1";
let legacyMigration: Promise<void> | undefined;
const modelImageJobs = new Map<string, Promise<string>>();
const textUpdateJobs = new Map<string, Promise<void>>();
const FILE_MIME_TYPES:Record<string,string>={
  ".txt":"text/plain", ".md":"text/markdown", ".csv":"text/csv", ".tsv":"text/tab-separated-values",
  ".json":"application/json", ".xml":"application/xml", ".yaml":"application/yaml", ".yml":"application/yaml",
  ".html":"text/html", ".htm":"text/html", ".css":"text/css", ".js":"text/javascript", ".mjs":"text/javascript",
  ".cjs":"text/javascript", ".ts":"text/typescript", ".tsx":"text/typescript", ".jsx":"text/jsx", ".py":"text/x-python",
  ".sql":"text/x-sql", ".log":"text/plain", ".toml":"application/toml", ".ini":"text/plain", ".ps1":"text/plain", ".sh":"text/x-shellscript",
  ".zip":"application/zip", ".gz":"application/gzip", ".tar":"application/x-tar", ".7z":"application/x-7z-compressed",
  ".docx":"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx":"application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

function assertId(id: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid upload id");
}

const pathsFor = (id: string) => {
  assertId(id);
  return {
    original: path.join(uploadsDir, `${id}.original`),
    thumbnail: path.join(uploadsDir, `${id}.thumbnail`),
    legacyModelImage: path.join(uploadsDir, `${id}.model.jpg`),
    previousModelImage: path.join(uploadsDir, `${id}.model-v2.jpg`),
    extraction: path.join(uploadsDir, `${id}.pdf.json`),
    metadata: path.join(uploadsDir, `${id}.json`),
  };
};

const modelImagePath = (id: string, maxEdgePixels: number) => {
  assertId(id);
  return path.join(uploadsDir, `${id}.model-v3-${maxEdgePixels}.jpg`);
};

type UploadRow = {
  id: string;
  name: string;
  mime_type: string;
  size: number;
  width: number | null;
  height: number | null;
  created_at?: string;
  retained?: number;
  reference_count?: number;
  deleted_at?: string | null;
};

function toAttachment(row: UploadRow): StoredAttachment {
  return {
    id: row.id,
    name: row.name,
    mimeType: row.mime_type,
    size: row.size,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    url: `/api/uploads/${row.id}`,
    ...(row.mime_type.startsWith("image/") ? { thumbnailUrl: `/api/uploads/${row.id}?variant=thumbnail` } : {}),
  };
}

export async function ensureLegacyUploadsMigrated() {
  if (storageMigrationCompleted(legacyMigrationName)) return;
  legacyMigration ??= (async () => {
    await fs.mkdir(uploadsDir, { recursive: true });
    const files = (await fs.readdir(uploadsDir)).filter((file) => file.endsWith(".json"));
    const legacyOwner = db.prepare("SELECT id FROM users WHERE role = 'superadmin' ORDER BY created_at LIMIT 1").get() as { id: string } | undefined;
    const insert = db.prepare(`
      INSERT OR IGNORE INTO uploads(id, name, mime_type, size, width, height, created_at, user_id)
      VALUES (@id, @name, @mimeType, @size, @width, @height, @createdAt, @userId)
    `);
    const migrate = db.transaction((records: Array<StoredAttachment & { createdAt: string }>) => {
      for (const record of records) insert.run({ ...record, userId: legacyOwner?.id ?? null });
      completeStorageMigration(legacyMigrationName);
    });
    const records: Array<StoredAttachment & { createdAt: string }> = [];
    for (const file of files) {
      try {
        const value = JSON.parse(await fs.readFile(path.join(uploadsDir, file), "utf8")) as StoredAttachment;
        assertId(value.id);
        if (!value.mimeType?.startsWith("image/") || !Number.isFinite(value.size)) continue;
        records.push({ ...value, createdAt: new Date().toISOString() });
      } catch (error) {
        console.error(`Skipping invalid legacy upload metadata: ${file}`, error);
      }
    }
    migrate(records);
  })().finally(() => { legacyMigration = undefined; });
  await legacyMigration;
}

function insertWithinQuota(row: { id:string; name:string; mimeType:string; size:number; width?:number; height?:number; userId:string; retained:boolean; reservationId?:string }) {
  db.transaction(() => {
    const quota = db.prepare("SELECT storage_quota_bytes AS quota FROM users WHERE id = ?").get(row.userId) as { quota: number } | undefined;
    if (!quota) throw new Error("Storage owner not found.");
    if(row.reservationId){const reservation=db.prepare("SELECT size,completed_upload_id AS completedUploadId FROM storage_upload_sessions WHERE id=? AND user_id=?").get(row.reservationId,row.userId) as {size:number;completedUploadId:string|null}|undefined;if(!reservation||reservation.size!==row.size)throw new Error("Upload reservation not found.");if(reservation.completedUploadId)throw new Error("Upload is already complete.");}
    const used = (db.prepare("SELECT COALESCE(SUM(size), 0) AS bytes FROM uploads WHERE user_id = ? AND deleted_at IS NULL").get(row.userId) as { bytes: number }).bytes;
    const pending=(db.prepare("SELECT COALESCE(SUM(size),0) AS bytes FROM storage_upload_sessions WHERE user_id=? AND completed_upload_id IS NULL AND (? IS NULL OR id<>?)").get(row.userId,row.reservationId??null,row.reservationId??null) as {bytes:number}).bytes;
    if (used + pending + row.size > quota.quota) throw new Error(`Storage quota exceeded (${used + pending + row.size} / ${quota.quota} bytes).`);
    db.prepare(`INSERT INTO uploads(id, name, mime_type, size, width, height, created_at, user_id, retained) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(row.id, row.name, row.mimeType, row.size, row.width ?? null, row.height ?? null, new Date().toISOString(), row.userId, Number(row.retained));
    if(row.reservationId)db.prepare("UPDATE storage_upload_sessions SET completed_upload_id=? WHERE id=? AND user_id=? AND completed_upload_id IS NULL").run(row.id,row.reservationId,row.userId);
  })();
}

function assertQuotaPreflight(userId:string,size:number,reservationId?:string){
  const quota=db.prepare("SELECT storage_quota_bytes AS quota FROM users WHERE id = ?").get(userId) as {quota:number}|undefined;
  if(!quota)throw new Error("Storage owner not found.");
  const used=(db.prepare("SELECT COALESCE(SUM(size), 0) AS bytes FROM uploads WHERE user_id = ? AND deleted_at IS NULL").get(userId) as {bytes:number}).bytes;
  const pending=(db.prepare("SELECT COALESCE(SUM(size),0) AS bytes FROM storage_upload_sessions WHERE user_id=? AND completed_upload_id IS NULL AND (? IS NULL OR id<>?)").get(userId,reservationId??null,reservationId??null) as {bytes:number}).bytes;
  if(used+pending+size>quota.quota)throw new Error(`Storage quota exceeded (${used+pending+size} / ${quota.quota} bytes).`);
}

function storedFileMimeType(header:Buffer,name:string){
  const raster=sniffRasterMimeType(header);if(raster)return raster;
  if(header.subarray(0,5).toString("ascii")==="%PDF-")return "application/pdf";
  return FILE_MIME_TYPES[path.extname(name).toLowerCase()]||"application/octet-stream";
}

function safeStoredName(value:string){
  const name=String(value||"").normalize("NFC").replace(/[\u0000-\u001f\u007f]/g,"").replace(/[\\/]+/g,"-").trim();
  if(!name||name==="."||name==="..")throw new Error("A valid file name is required.");
  return name.slice(0,240);
}

const ARTIFACT_EXTENSIONS:Record<ArtifactKind,string>={html:".html",csv:".csv",json:".json",xml:".xml",markdown:".md"};

/** Turn an artifact title into a safe filename without duplicating its format extension. */
export function artifactStoredName(title:string,kind:ArtifactKind){
  const extension=ARTIFACT_EXTENSIONS[kind],clean=safeStoredName(title);
  if(clean.toLowerCase().endsWith(extension))return clean;
  return `${clean.slice(0,Math.max(1,240-extension.length)).trimEnd()}${extension}`;
}

function availableArtifactName(requested:string,names:Set<string>){
  if(!names.has(requested.toLowerCase()))return requested;
  const extension=path.extname(requested),stem=requested.slice(0,requested.length-extension.length);
  for(let index=1;index<1_000_000;index++){
    const suffix=` (${index})`,candidate=`${stem.slice(0,Math.max(1,240-extension.length-suffix.length)).trimEnd()}${suffix}${extension}`;
    if(!names.has(candidate.toLowerCase()))return candidate;
  }
  throw new Error("A unique artifact filename could not be allocated.");
}

async function createStoredThumbnail(source:string,destination:string){
  const temporary=`${destination}.${randomUUID()}.tmp`;
  try{
    const image=sharp(source,{limitInputPixels:200_000_000});const metadata=await image.metadata();
    await image.rotate().resize({width:512,height:512,fit:"inside",withoutEnlargement:true}).jpeg({quality:78,mozjpeg:true}).toFile(temporary);
    await fs.rename(temporary,destination);
    return{width:metadata.width,height:metadata.height};
  }catch{await fs.unlink(temporary).catch(()=>undefined);return undefined;}
}

/** Copy a regular host file into private retained storage without loading it into memory. */
export async function saveHostFile(sourcePath:string,userId:string){
  await ensureLegacyUploadsMigrated();
  const source=path.resolve(sourcePath);const sourceStats=await fs.stat(source);
  if(!sourceStats.isFile())throw new Error("Only regular files can be stored.");
  if(!Number.isSafeInteger(sourceStats.size)||sourceStats.size<0)throw new Error("The file size is not supported.");
  assertQuotaPreflight(userId,sourceStats.size);
  const id=randomUUID();const paths=pathsFor(id);const temporary=`${paths.original}.${randomUUID()}.tmp`;
  await fs.mkdir(uploadsDir,{recursive:true});
  try{
    await fs.copyFile(source,temporary,constants.COPYFILE_EXCL);
    await fs.chmod(temporary,0o600).catch(()=>undefined);
    const copied=await fs.stat(temporary);if(!copied.isFile()||copied.size!==sourceStats.size)throw new Error("The source file changed while it was being copied.");
    const handle=await fs.open(temporary,"r");const header=Buffer.alloc(Math.min(32,copied.size));try{if(header.length)await handle.read(header,0,header.length,0);}finally{await handle.close();}
    const name=path.basename(source).slice(0,240)||"file";let mimeType=storedFileMimeType(header,name);const dimensions=mimeType.startsWith("image/")?await createStoredThumbnail(temporary,paths.thumbnail):undefined;
    if(mimeType.startsWith("image/")&&!dimensions)mimeType="application/octet-stream";
    const metadata:StoredAttachment={id,name,mimeType,size:copied.size,width:dimensions?.width,height:dimensions?.height,url:`/api/uploads/${id}`,...(mimeType.startsWith("image/")?{thumbnailUrl:`/api/uploads/${id}?variant=thumbnail`}:{})};
    await fs.rename(temporary,paths.original);insertWithinQuota({...metadata,userId,retained:true});
    const escapedName=name.replace(/([\\\]])/g,"\\$1");
    return{metadata,path:paths.original,markdown:mimeType.startsWith("image/")?`![${escapedName}](${metadata.url})`:`[${escapedName}](${metadata.url}?download=1)`};
  }catch(error){await Promise.all([temporary,paths.original,paths.thumbnail].map(target=>fs.unlink(target).catch(()=>undefined)));throw error;}
}

/** Move an already assembled upload into retained owner-only storage without buffering it in memory. */
export async function saveStagedUpload(sourcePath:string,nameInput:string,userId:string,reservationId:string){
  await ensureLegacyUploadsMigrated();
  const source=path.resolve(sourcePath);const sourceStats=await fs.stat(source);
  if(!sourceStats.isFile())throw new Error("Only regular files can be stored.");
  if(!Number.isSafeInteger(sourceStats.size)||sourceStats.size<0)throw new Error("The file size is not supported.");
  assertQuotaPreflight(userId,sourceStats.size,reservationId);
  const name=safeStoredName(nameInput);const id=randomUUID();const paths=pathsFor(id);const handle=await fs.open(source,"r");const header=Buffer.alloc(Math.min(32,sourceStats.size));
  try{if(header.length)await handle.read(header,0,header.length,0);}finally{await handle.close();}
  let mimeType=storedFileMimeType(header,name);const dimensions=mimeType.startsWith("image/")?await createStoredThumbnail(source,paths.thumbnail):undefined;
  if(mimeType.startsWith("image/")&&!dimensions)mimeType="application/octet-stream";
  const metadata:StoredAttachment={id,name,mimeType,size:sourceStats.size,width:dimensions?.width,height:dimensions?.height,url:`/api/uploads/${id}`,...(mimeType.startsWith("image/")?{thumbnailUrl:`/api/uploads/${id}?variant=thumbnail`}:{})};
  await fs.mkdir(uploadsDir,{recursive:true});
  try{
    await fs.rename(source,paths.original);await fs.chmod(paths.original,0o600).catch(()=>undefined);
    insertWithinQuota({...metadata,userId,retained:true,reservationId});return metadata;
  }catch(error){await Promise.all([paths.original,paths.thumbnail].map(target=>fs.unlink(target).catch(()=>undefined)));throw error;}
}

export async function saveTextFile(nameInput:string,kind:"markdown"|"text",content:string,userId:string){
  const extension=kind==="markdown"?".md":"";let name=safeStoredName(nameInput);if(extension&&!name.toLowerCase().endsWith(extension))name=`${name.replace(/\.(?:md|txt)$/i,"")}${extension}`;
  const mimeType=kind==="markdown"?"text/markdown":FILE_MIME_TYPES[path.extname(name).toLowerCase()]||"text/plain";
  const data=Buffer.from(content,"utf8");assertQuotaPreflight(userId,data.length);const id=randomUUID();const paths=pathsFor(id);const temporary=`${paths.original}.${randomUUID()}.tmp`;
  const metadata:StoredAttachment={id,name,mimeType,size:data.length,url:`/api/uploads/${id}`};await fs.mkdir(uploadsDir,{recursive:true});
  try{await fs.writeFile(temporary,data,{mode:0o600,flag:"wx"});await fs.rename(temporary,paths.original);insertWithinQuota({...metadata,userId,retained:true});return metadata;}
  catch(error){await Promise.all([temporary,paths.original].map(target=>fs.unlink(target).catch(()=>undefined)));throw error;}
}

export type ArtifactStorageResult={attachment:StoredAttachment;requestedName:string;fileName:string;action:"created"|"updated";nameChanged:boolean};

/**
 * Keep one storage object per canonical artifact name and conversation. The SQLite write
 * transaction chooses collision suffixes and swaps the UTF-8 body while holding the same lock,
 * so concurrent artifact calls cannot claim the same active filename.
 */
export async function saveArtifactFile(title:string,kind:ArtifactKind,content:string,userId:string,conversationId:string):Promise<ArtifactStorageResult>{
  await ensureLegacyUploadsMigrated();
  if(!conversationId||conversationId.length>200)throw new Error("A valid artifact conversation is required.");
  const requestedName=artifactStoredName(title,kind),artifactKey=requestedName.normalize("NFC").toLowerCase();
  const data=Buffer.from(content,"utf8"),mimeType=FILE_MIME_TYPES[ARTIFACT_EXTENSIONS[kind]];
  const temporary=path.join(uploadsDir,`.artifact-${randomUUID()}.tmp`);
  await fs.mkdir(uploadsDir,{recursive:true});await fs.writeFile(temporary,data,{mode:0o600,flag:"wx"});
  let targetOriginal="",backup="",replacementInstalled=false;
  try{
    const saved=db.transaction(()=>{
      const conversation=db.prepare("SELECT 1 FROM conversations WHERE id=? AND user_id=? AND deleted_at IS NULL").get(conversationId,userId);
      if(!conversation)throw new Error("Artifact conversation not found.");
      const account=db.prepare("SELECT storage_quota_bytes AS quota FROM users WHERE id=?").get(userId) as {quota:number}|undefined;
      if(!account)throw new Error("Storage owner not found.");
      const used=(db.prepare("SELECT COALESCE(SUM(size),0) AS bytes FROM uploads WHERE user_id=? AND deleted_at IS NULL").get(userId) as {bytes:number}).bytes;
      const pending=(db.prepare("SELECT COALESCE(SUM(size),0) AS bytes FROM storage_upload_sessions WHERE user_id=? AND completed_upload_id IS NULL").get(userId) as {bytes:number}).bytes;
      const linked=db.prepare(`SELECT u.id,u.name,u.mime_type,u.size,u.width,u.height FROM artifact_storage_links l JOIN uploads u ON u.id=l.upload_id WHERE l.user_id=? AND l.conversation_id=? AND l.artifact_key=? AND u.user_id=? AND u.deleted_at IS NULL`).get(userId,conversationId,artifactKey,userId) as UploadRow|undefined;
      const stamp=new Date().toISOString();
      if(linked){
        if(used-linked.size+pending+data.length>account.quota)throw new Error("Storage quota exceeded by the updated artifact.");
        const paths=pathsFor(linked.id);targetOriginal=paths.original;backup=`${paths.original}.${randomUUID()}.bak`;
        renameSync(paths.original,backup);renameSync(temporary,paths.original);replacementInstalled=true;
        db.prepare("UPDATE uploads SET mime_type=?,size=? WHERE id=? AND user_id=? AND deleted_at IS NULL").run(mimeType,data.length,linked.id,userId);
        db.prepare("UPDATE artifact_storage_links SET updated_at=? WHERE user_id=? AND conversation_id=? AND artifact_key=?").run(stamp,userId,conversationId,artifactKey);
        const attachment=toAttachment({...linked,mime_type:mimeType,size:data.length});
        return{attachment,requestedName,fileName:attachment.name,action:"updated" as const,nameChanged:attachment.name!==requestedName};
      }
      if(used+pending+data.length>account.quota)throw new Error("Storage quota exceeded by the artifact.");
      const activeNames=new Set((db.prepare("SELECT name FROM uploads WHERE user_id=? AND deleted_at IS NULL").all(userId) as Array<{name:string}>).map(row=>row.name.toLowerCase()));
      for(const row of db.prepare(`SELECT l.artifact_key AS name FROM artifact_storage_links l JOIN uploads u ON u.id=l.upload_id WHERE l.user_id=? AND u.deleted_at IS NULL`).all(userId) as Array<{name:string}>)activeNames.add(row.name.toLowerCase());
      const name=availableArtifactName(requestedName,activeNames),id=randomUUID(),paths=pathsFor(id);
      targetOriginal=paths.original;renameSync(temporary,paths.original);replacementInstalled=true;
      db.prepare("INSERT INTO uploads(id,name,mime_type,size,width,height,created_at,user_id,retained) VALUES(?,?,?,?,NULL,NULL,?,?,1)").run(id,name,mimeType,data.length,stamp,userId);
      db.prepare(`INSERT INTO artifact_storage_links(user_id,conversation_id,artifact_key,upload_id,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,conversation_id,artifact_key) DO UPDATE SET upload_id=excluded.upload_id,updated_at=excluded.updated_at`).run(userId,conversationId,artifactKey,id,stamp,stamp);
      const attachment:StoredAttachment={id,name,mimeType,size:data.length,url:`/api/uploads/${id}`};
      return{attachment,requestedName,fileName:name,action:"created" as const,nameChanged:name!==requestedName};
    })();
    if(backup)rmSync(backup,{force:true});
    return saved;
  }catch(error){
    if(replacementInstalled&&targetOriginal)try{rmSync(targetOriginal,{force:true});}catch{/* best-effort rollback */}
    if(backup&&targetOriginal)try{renameSync(backup,targetOriginal);}catch{/* preserve the original error */}
    throw error;
  }finally{
    try{rmSync(temporary,{force:true});}catch{/* best-effort cleanup */}
    if(backup)try{rmSync(backup,{force:true});}catch{/* best-effort cleanup */}
  }
}

export async function saveUpload(file: File, thumbnail: File | undefined, userId: string, settings: ToolSettings, dimensions?: { width?: number; height?: number }, retained = false): Promise<StoredAttachment> {
  await ensureLegacyUploadsMigrated();
  const pdf = file.type.toLowerCase() === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const mimeType = pdf ? "application/pdf" : file.type.toLowerCase();
  if (!isSupportedUploadMimeType(mimeType)) throw new Error("Only safe raster images and PDF files are supported.");
  const sizeLimitMb = pdf ? settings.pdfSizeLimitMb : settings.imageUploadLimitMb;
  if (file.size > sizeLimitMb * 1024 * 1024) throw new Error(`${file.name} exceeds the configured ${sizeLimitMb} MB limit.`);
  if (!pdf && (!thumbnail || !isSupportedUploadMimeType(thumbnail.type) || !thumbnail.type.startsWith("image/") || thumbnail.size > settings.imageUploadLimitMb * 1024 * 1024)) throw new Error("Invalid thumbnail.");
  const id = randomUUID();
  const paths = pathsFor(id);
  const metadata: StoredAttachment = {
    id, name: file.name.slice(0, 240), mimeType, size: file.size,
    width: dimensions?.width, height: dimensions?.height,
    url: `/api/uploads/${id}`, ...(pdf ? {} : { thumbnailUrl: `/api/uploads/${id}?variant=thumbnail` }),
  };
  await fs.mkdir(uploadsDir, { recursive: true });
  const originalTemp = `${paths.original}.${randomUUID()}.tmp`;
  const thumbnailTemp = `${paths.thumbnail}.${randomUUID()}.tmp`;
  const extractionTemp = `${paths.extraction}.${randomUUID()}.tmp`;
  try {
    const original = Buffer.from(await file.arrayBuffer());
    assertUploadSignature(original, mimeType);
    await fs.writeFile(originalTemp, original, { mode: 0o600 });
    if (pdf) {
      const extraction = await extractPdf(originalTemp, settings);
      await fs.writeFile(extractionTemp, JSON.stringify(extraction), { encoding: "utf8", mode: 0o600 });
    } else if (thumbnail) {
      const thumbnailData = Buffer.from(await thumbnail.arrayBuffer()); assertUploadSignature(thumbnailData, thumbnail.type);
      await sharp(thumbnailData,{limitInputPixels:40_000_000}).rotate().resize({width:512,height:512,fit:"inside",withoutEnlargement:true}).jpeg({quality:78,mozjpeg:true}).toFile(thumbnailTemp);
      await fs.chmod(thumbnailTemp,0o600).catch(()=>undefined);
    }
    await fs.rename(originalTemp, paths.original);
    if (pdf) await fs.rename(extractionTemp, paths.extraction);
    else await fs.rename(thumbnailTemp, paths.thumbnail);
    insertWithinQuota({ ...metadata, userId, retained });
    return metadata;
  } catch (error) {
    await Promise.all([paths.original, paths.thumbnail, paths.extraction, originalTemp, thumbnailTemp, extractionTemp].map((target) => fs.unlink(target).catch(() => undefined)));
    throw error;
  }
}

/** Save tool-generated imagery as an owned retained file; native LM Studio can read this path directly. */
export async function saveGeneratedImage(buffer: Buffer, userId: string, name = `host-screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}.png`, dimensions?: { width?: number; height?: number }, mimeType = "image/png") {
  assertUploadSignature(buffer, mimeType);
  const id = randomUUID(); const paths = pathsFor(id);
  const metadata: StoredAttachment = { id, name: name.slice(0, 240), mimeType, size: buffer.length, width: dimensions?.width, height: dimensions?.height, url: `/api/uploads/${id}`, thumbnailUrl: `/api/uploads/${id}?variant=thumbnail` };
  await fs.mkdir(uploadsDir, { recursive: true });
  const temporary = `${paths.original}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, buffer, { mode: 0o600 });
    await fs.rename(temporary, paths.original);
    await createStoredThumbnail(paths.original,paths.thumbnail);
    insertWithinQuota({ ...metadata, userId, retained: true });
    return { metadata, path: paths.original };
  } catch (error) {
    await Promise.all([temporary, paths.original, paths.thumbnail].map(target=>fs.unlink(target).catch(()=>undefined)));
    throw error;
  }
}

export async function storageSummary(userId: string) {
  await ensureLegacyUploadsMigrated();
  const account = db.prepare("SELECT storage_quota_bytes AS quotaBytes FROM users WHERE id = ?").get(userId) as { quotaBytes: number } | undefined;
  if (!account) throw Object.assign(new Error("Storage owner not found."), { code: "ENOENT" });
  const files = db.prepare(`
    SELECT u.id, u.name, u.mime_type, u.size, u.width, u.height, u.created_at, u.retained,
      (SELECT COUNT(DISTINCT m.conversation_id) FROM message_attachments ma JOIN messages m ON m.id=ma.message_id JOIN conversations c ON c.id=m.conversation_id WHERE ma.upload_id=u.id AND c.deleted_at IS NULL) AS reference_count
    FROM uploads u WHERE u.user_id = ? AND u.deleted_at IS NULL ORDER BY u.created_at DESC
  `).all(userId) as UploadRow[];
  const mapped: StorageFile[] = files.map(row=>({ ...toAttachment(row), createdAt: row.created_at!, referenceCount: row.reference_count || 0, retained: row.retained === 1 }));
  return { quotaBytes: account.quotaBytes, usedBytes: mapped.reduce((sum,file)=>sum+file.size,0), files: mapped };
}

export async function managedStorageFiles(userId:string){await ensureLegacyUploadsMigrated();const rows=db.prepare("SELECT id,name,mime_type,size,width,height,created_at,deleted_at,retained,(SELECT COUNT(DISTINCT m.conversation_id) FROM message_attachments ma JOIN messages m ON m.id=ma.message_id JOIN conversations c ON c.id=m.conversation_id WHERE ma.upload_id=uploads.id AND c.deleted_at IS NULL) AS reference_count FROM uploads WHERE user_id=? ORDER BY created_at DESC").all(userId) as UploadRow[];return rows.map(row=>({...toAttachment(row),createdAt:row.created_at!,referenceCount:row.reference_count||0,retained:row.retained===1,...(row.deleted_at?{deletedAt:row.deleted_at}:{})})) as StorageFile[];}

export type StorageSort="created_desc"|"created_asc"|"name_asc"|"name_desc"|"size_asc"|"size_desc";
export async function storagePage(userId:string,input:{page?:number;pageSize?:number;sort?:StorageSort;query?:string;state?:"all"|"active"|"deleted";attachableOnly?:boolean}={}){
  await ensureLegacyUploadsMigrated();
  const account=db.prepare(`SELECT u.storage_quota_bytes AS quotaBytes,u.trash_quota_bytes AS trashQuotaBytes,COALESCE(SUM(CASE WHEN up.deleted_at IS NULL THEN up.size ELSE 0 END),0) AS usedBytes,COALESCE(SUM(CASE WHEN up.deleted_at IS NOT NULL THEN up.size ELSE 0 END),0) AS trashUsedBytes FROM users u LEFT JOIN uploads up ON up.user_id=u.id WHERE u.id=? GROUP BY u.id`).get(userId) as {quotaBytes:number;trashQuotaBytes:number;usedBytes:number;trashUsedBytes:number}|undefined;
  if(!account)throw Object.assign(new Error("Storage owner not found."),{code:"ENOENT"});
  const state=input.state==="all"||input.state==="deleted"?input.state:"active";const stateSql=state==="all"?"":state==="deleted"?"AND u.deleted_at IS NOT NULL":"AND u.deleted_at IS NULL";const attachableSql=input.attachableOnly?"AND (u.mime_type LIKE 'image/%' OR u.mime_type='application/pdf')":"";const query=String(input.query||"").trim().slice(0,200);const searchSql=query?"AND instr(lower(u.name),lower(?))>0":"";const filterArgs=query?[query]:[];
  const total=(db.prepare(`SELECT COUNT(*) AS total FROM uploads u WHERE u.user_id=? ${stateSql} ${attachableSql} ${searchSql}`).get(userId,...filterArgs) as {total:number}).total;
  const pageSize=Math.max(1,Math.min(100,Math.floor(input.pageSize||24)));const pageCount=Math.max(1,Math.ceil(total/pageSize));const page=Math.max(1,Math.min(pageCount,Math.floor(input.page||1)));
  const sort:StorageSort=(["created_desc","created_asc","name_asc","name_desc","size_asc","size_desc"] as StorageSort[]).includes(input.sort as StorageSort)?input.sort as StorageSort:"created_desc";
  const order:{[key in StorageSort]:string}={created_desc:"u.created_at DESC,u.id",created_asc:"u.created_at ASC,u.id",name_asc:"LOWER(u.name) ASC,u.id",name_desc:"LOWER(u.name) DESC,u.id",size_asc:"u.size ASC,u.id",size_desc:"u.size DESC,u.id"};
  const rows=db.prepare(`SELECT u.id,u.name,u.mime_type,u.size,u.width,u.height,u.created_at,u.deleted_at,u.retained,(SELECT COUNT(DISTINCT m.conversation_id) FROM message_attachments ma JOIN messages m ON m.id=ma.message_id JOIN conversations c ON c.id=m.conversation_id WHERE ma.upload_id=u.id AND c.deleted_at IS NULL) AS reference_count FROM uploads u WHERE u.user_id=? ${stateSql} ${attachableSql} ${searchSql} ORDER BY ${order[sort]} LIMIT ? OFFSET ?`).all(userId,...filterArgs,pageSize,(page-1)*pageSize) as UploadRow[];
  const files:StorageFile[]=rows.map(row=>({...toAttachment(row),createdAt:row.created_at!,referenceCount:row.reference_count||0,retained:row.retained===1,...(row.deleted_at?{deletedAt:row.deleted_at}:{})}));
  return{quotaBytes:account.quotaBytes,usedBytes:account.usedBytes,trashQuotaBytes:account.trashQuotaBytes,trashUsedBytes:account.trashUsedBytes,total,page,pageSize,pageCount,sort,query,state,files};
}

export async function readUpload(id: string, userId: string) {
  await ensureLegacyUploadsMigrated();
  assertId(id);
  const row = db.prepare("SELECT id, name, mime_type, size, width, height FROM uploads WHERE id = ? AND user_id = ? AND deleted_at IS NULL").get(id, userId) as UploadRow | undefined;
  if (!row) throw Object.assign(new Error("Attachment not found."), { code: "ENOENT" });
  return { metadata: toAttachment(row), paths: pathsFor(id) };
}

export async function renameStoredFile(id:string,userId:string,nameInput:string){
  await ensureLegacyUploadsMigrated();assertId(id);const name=safeStoredName(nameInput);
  return db.transaction(()=>{
    const row=db.prepare("SELECT id,name,mime_type,size,width,height FROM uploads WHERE id=? AND user_id=? AND deleted_at IS NULL").get(id,userId) as UploadRow|undefined;
    if(!row)throw Object.assign(new Error("Attachment not found."),{code:"ENOENT"});
    const extensionMime=FILE_MIME_TYPES[path.extname(name).toLowerCase()];
    const mimeType=isEditableStorageFile(row.name,row.mime_type)&&extensionMime&&isEditableStorageFile(name,extensionMime)?extensionMime:row.mime_type;
    db.prepare("UPDATE uploads SET name=?,mime_type=? WHERE id=? AND user_id=? AND deleted_at IS NULL").run(name,mimeType,id,userId);
    return{...toAttachment({...row,name,mime_type:mimeType})};
  })();
}

async function replaceStoredTextFileUnlocked(id:string,userId:string,content:string){
  const {metadata,paths}=await readUpload(id,userId);
  if(!isEditableStorageFile(metadata.name,metadata.mimeType))throw new Error("This file type cannot be edited as text.");
  const data=Buffer.from(content,"utf8"),temporary=`${paths.original}.${randomUUID()}.tmp`,backup=`${paths.original}.${randomUUID()}.bak`;
  await fs.writeFile(temporary,data,{mode:0o600,flag:"wx"});
  let originalMoved=false,replacementInstalled=false;
  try{
    db.transaction(()=>{
      const row=db.prepare("SELECT size FROM uploads WHERE id=? AND user_id=? AND deleted_at IS NULL").get(id,userId) as {size:number}|undefined;
      if(!row)throw Object.assign(new Error("Attachment not found."),{code:"ENOENT"});
      const account=db.prepare("SELECT storage_quota_bytes AS quota FROM users WHERE id=?").get(userId) as {quota:number}|undefined;
      if(!account)throw new Error("Storage owner not found.");
      const used=(db.prepare("SELECT COALESCE(SUM(size),0) AS bytes FROM uploads WHERE user_id=? AND deleted_at IS NULL").get(userId) as {bytes:number}).bytes;
      if(used-row.size+data.length>account.quota)throw new Error("Storage quota exceeded by the edited file.");
    })();
    await fs.rename(paths.original,backup);originalMoved=true;
    await fs.rename(temporary,paths.original);replacementInstalled=true;
    db.transaction(()=>{
      const row=db.prepare("SELECT size FROM uploads WHERE id=? AND user_id=? AND deleted_at IS NULL").get(id,userId) as {size:number}|undefined;
      if(!row)throw Object.assign(new Error("Attachment not found."),{code:"ENOENT"});
      const account=db.prepare("SELECT storage_quota_bytes AS quota FROM users WHERE id=?").get(userId) as {quota:number}|undefined;
      if(!account)throw new Error("Storage owner not found.");
      const used=(db.prepare("SELECT COALESCE(SUM(size),0) AS bytes FROM uploads WHERE user_id=? AND deleted_at IS NULL").get(userId) as {bytes:number}).bytes;
      if(used-row.size+data.length>account.quota)throw new Error("Storage quota exceeded by the edited file.");
      const result=db.prepare("UPDATE uploads SET size=? WHERE id=? AND user_id=? AND deleted_at IS NULL").run(data.length,id,userId);
      if(!result.changes)throw Object.assign(new Error("Attachment not found."),{code:"ENOENT"});
    })();
    await fs.unlink(backup);
    return{...metadata,size:data.length};
  }catch(error){
    if(replacementInstalled)await fs.unlink(paths.original).catch(()=>undefined);
    if(originalMoved)await fs.rename(backup,paths.original).catch(()=>undefined);
    throw error;
  }finally{await fs.unlink(temporary).catch(()=>undefined);await fs.unlink(backup).catch(()=>undefined);}
}

/** Replace an owner-scoped editable text file while serializing writes to the same stored object. */
export async function replaceStoredTextFile(id:string,userId:string,content:string){
  const key=`${userId}:${id}`,previous=textUpdateJobs.get(key)??Promise.resolve();
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});const queued=previous.catch(()=>undefined).then(()=>gate);textUpdateJobs.set(key,queued);
  await previous.catch(()=>undefined);
  try{return await replaceStoredTextFileUnlocked(id,userId,content);}finally{release();if(textUpdateJobs.get(key)===queued)textUpdateJobs.delete(key);}
}

export async function readManagedUpload(id: string, userId: string) {
  await ensureLegacyUploadsMigrated();assertId(id);const row=db.prepare("SELECT id,name,mime_type,size,width,height,deleted_at FROM uploads WHERE id=? AND user_id=?").get(id,userId) as UploadRow|undefined;
  if(!row)throw Object.assign(new Error("Attachment not found."),{code:"ENOENT"});return{metadata:{...toAttachment(row),...(row.deleted_at?{deletedAt:row.deleted_at}:{})},paths:pathsFor(id)};
}

export async function readUploadDataUrl(id: string, userId: string) {
  const { metadata, paths } = await readUpload(id, userId);
  if (!metadata.mimeType.startsWith("image/")) throw new Error("This attachment is not an image.");
  const data = await fs.readFile(/* turbopackIgnore: true */ paths.original);
  return `data:${metadata.mimeType};base64,${data.toString("base64")}`;
}

export async function readUploadModelContent(id: string, userId: string, settings: ToolSettings, model?: Pick<ModelConfig, "visionImageMode" | "visionMaxEdgePixels">, signal?: AbortSignal): Promise<ModelContentPart[]> {
  signal?.throwIfAborted();
  const { metadata, paths } = await readUpload(id, userId);
  if (metadata.mimeType.startsWith("image/")) {
    const vision = resolvedVisionSettings(model);
    if (vision.mode === "original") return [{ type: "image_file", file_path: paths.original, mime_type: metadata.mimeType }];
    const destination = modelImagePath(id, vision.maxEdgePixels);
    const jobKey = `${id}:${vision.maxEdgePixels}`;
    let job = modelImageJobs.get(jobKey);
    if (!job) {
      job = (async () => {
        try { await fs.access(destination); return destination; } catch { /* Build the immutable derivative once. */ }
        const temporary = `${destination}.${randomUUID()}.tmp`;
        try {
          await sharp(paths.original, { limitInputPixels: 200_000_000, sequentialRead: true, pages: 1 }).rotate()
            .resize({ width: vision.maxEdgePixels, height: vision.maxEdgePixels, fit: "inside", withoutEnlargement: true })
            .flatten({ background: "#ffffff" }).jpeg({ quality: 82, mozjpeg: true }).toFile(temporary);
          await fs.chmod(temporary, 0o600).catch(() => undefined); await fs.rename(temporary, destination); return destination;
        } finally { await fs.unlink(temporary).catch(() => undefined); }
      })().finally(() => { modelImageJobs.delete(jobKey); });
      modelImageJobs.set(jobKey, job);
    }
    const filePath = await job; signal?.throwIfAborted();
    return [{ type: "image_file", file_path: filePath, mime_type: "image/jpeg" }];
  }
  if (metadata.mimeType === "application/pdf") {
    let cached: PdfExtraction | undefined;
    try {
      const candidate = JSON.parse(await fs.readFile(/* turbopackIgnore: true */ paths.extraction, "utf8")) as PdfExtraction;
      if (candidate.pageLimit === settings.pdfPageLimit && candidate.characterLimit === settings.pdfTextCharacterLimit) cached = candidate;
    } catch { /* Rebuild missing or stale extraction cache. */ }
    if (!cached) {
      cached = await extractPdf(paths.original, settings, signal);
      const cacheTemp = `${paths.extraction}.${randomUUID()}.tmp`;
      try { await fs.writeFile(cacheTemp, JSON.stringify(cached), { encoding: "utf8", mode: 0o600 }); await fs.rename(cacheTemp, paths.extraction); }
      finally { await fs.unlink(cacheTemp).catch(() => undefined); }
    }
    const processed = await pdfModelContent(paths.original, metadata.name, settings, cached, signal);
    return processed.content;
  }
  throw new Error("Unsupported attachment type.");
}

export async function deleteUpload(id: string, userId: string) {
  await moveUploadsToTrash([id], userId);
}

export async function moveUploadsToTrash(ids: string[], userId: string) {
  await ensureLegacyUploadsMigrated();
  const unique = [...new Set(ids.map(String))];
  if (!unique.length || unique.length > 100) throw new Error("Select 1 to 100 files.");
  unique.forEach(assertId); const placeholders = unique.map(() => "?").join(",");
  return db.transaction(() => {
    const rows = db.prepare(`SELECT u.id,(SELECT COUNT(DISTINCT m.conversation_id) FROM message_attachments ma JOIN messages m ON m.id=ma.message_id JOIN conversations c ON c.id=m.conversation_id WHERE ma.upload_id=u.id AND c.deleted_at IS NULL) AS reference_count FROM uploads u WHERE u.user_id=? AND u.deleted_at IS NULL AND u.id IN (${placeholders})`).all(userId, ...unique) as Array<{id:string;reference_count:number}>;
    if (rows.length !== unique.length) throw Object.assign(new Error("One or more selected files were not found."), { code: "ENOENT" });
    if (rows.some(row => row.reference_count > 0)) throw new Error("Files attached to saved conversations cannot be deleted.");
    const stamp = new Date().toISOString();
    for (const id of unique) db.prepare("UPDATE uploads SET deleted_at=? WHERE id=? AND user_id=? AND deleted_at IS NULL").run(stamp, id, userId);
    return unique.length;
  })();
}

export async function restoreUpload(id:string,userId:string){await ensureLegacyUploadsMigrated();assertId(id);db.transaction(()=>{const row=db.prepare("SELECT size FROM uploads WHERE id=? AND user_id=? AND deleted_at IS NOT NULL").get(id,userId) as {size:number}|undefined;if(!row)throw Object.assign(new Error("Deleted file not found."),{code:"ENOENT"});const account=db.prepare("SELECT storage_quota_bytes AS quota FROM users WHERE id=?").get(userId) as {quota:number};const used=(db.prepare("SELECT COALESCE(SUM(size),0) AS bytes FROM uploads WHERE user_id=? AND deleted_at IS NULL").get(userId) as {bytes:number}).bytes;if(used+row.size>account.quota)throw new Error("Storage quota exceeded; increase the active quota before restoring this file.");db.prepare("UPDATE uploads SET deleted_at=NULL WHERE id=? AND user_id=? AND deleted_at IS NOT NULL").run(id,userId);})();}

export async function permanentlyDeleteUpload(id:string,userId:string){await ensureLegacyUploadsMigrated();assertId(id);const row=db.prepare("SELECT 1 FROM uploads WHERE id=? AND user_id=? AND deleted_at IS NOT NULL").get(id,userId);if(!row)throw Object.assign(new Error("Deleted file not found."),{code:"ENOENT"});const references=(db.prepare("SELECT COUNT(*) AS count FROM message_attachments WHERE upload_id=?").get(id) as {count:number}).count;if(references)throw new Error("Delete or permanently remove the referenced conversation first.");db.prepare("DELETE FROM uploads WHERE id=? AND user_id=? AND deleted_at IS NOT NULL").run(id,userId);await deleteUploadFiles(id);}

export async function purgeDeletedUploads(userId:string,retentionDays:number){
  await ensureLegacyUploadsMigrated();const cutoff=new Date(Date.now()-Math.max(1,Math.min(60,Math.floor(retentionDays)))*86400_000).toISOString();
  const selected=db.transaction(()=>{const account=db.prepare("SELECT trash_quota_bytes AS quota FROM users WHERE id=?").get(userId) as {quota:number}|undefined;if(!account)return[] as string[];const rows=db.prepare("SELECT id,size,deleted_at,EXISTS(SELECT 1 FROM message_attachments WHERE upload_id=uploads.id) AS referenced FROM uploads WHERE user_id=? AND deleted_at IS NOT NULL ORDER BY deleted_at,id").all(userId) as Array<{id:string;size:number;deleted_at:string;referenced:number}>;let used=rows.reduce((sum,row)=>sum+row.size,0);const ids:string[]=[];for(const row of rows)if(!row.referenced&&(row.deleted_at<=cutoff||used>account.quota)){ids.push(row.id);used-=row.size;}for(const id of ids)db.prepare("DELETE FROM uploads WHERE id=? AND user_id=? AND deleted_at IS NOT NULL").run(id,userId);return ids;})();
  await Promise.all(selected.map(id=>deleteUploadFiles(id)));return selected.length;
}

export async function deleteUploadFiles(id: string) {
  const paths = pathsFor(id);
  const configuredDerivatives = await fs.readdir(uploadsDir).then(files => files.filter(file => file.startsWith(`${id}.model-v3-`) && file.endsWith(".jpg")).map(file => path.join(uploadsDir, file)), () => [] as string[]);
  await Promise.all([...Object.values(paths), ...configuredDerivatives].map((target) => fs.unlink(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  })));
}

export async function cleanupOrphanedUploads(settings: ToolSettings) {
  await ensureLegacyUploadsMigrated();
  const cutoff = new Date(Date.now() - settings.orphanUploadTtlHours * 60 * 60 * 1_000).toISOString();
  const ids = db.transaction(() => {
    const rows = db.prepare(`
      SELECT u.id FROM uploads u
      WHERE u.created_at < ? AND u.deleted_at IS NULL AND u.retained = 0 AND NOT EXISTS (SELECT 1 FROM message_attachments ma WHERE ma.upload_id = u.id)
    `).all(cutoff) as Array<{ id: string }>;
    for (const row of rows) db.prepare("DELETE FROM uploads WHERE id = ?").run(row.id);
    return rows.map((row) => row.id);
  })();
  await Promise.all(ids.map((id) => deleteUploadFiles(id)));
  return ids.length;
}
