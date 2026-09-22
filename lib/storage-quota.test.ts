import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const root=await mkdtemp(path.join(os.tmpdir(),"neural-storage-test-"));
process.env.NEURAL_CHAT_DATA_DIR=root;
const {db}=await import("./database.ts");
const {deleteUpload,moveUploadsToTrash,purgeDeletedUploads,readUploadModelContent,restoreUpload,saveGeneratedImage,saveHostFile,storagePage,storageSummary}=await import("./uploads.ts");
const {executeHostComputerTool}=await import("./host-computer-tool.ts");
const {executeStorageAccessTool}=await import("./storage-tool.ts");
const toolSettings={maxToolRounds:8,maxBrowserTabs:8,maxMultipleChoiceQuestions:3,maxAttachmentsPerMessage:12,textDownloadLimitMb:1,textCharacterLimit:24_000,imageDownloadLimitMb:10,imageUploadLimitMb:20,pdfSizeLimitMb:25,pdfPageLimit:100,pdfTextCharacterLimit:100_000,pdfVisionPageLimit:6,pdfProcessingTimeoutSeconds:30,temporaryFileTtlMinutes:60,orphanUploadTtlHours:24};

test("user storage quota is enforced atomically and generated images are retained",async()=>{
  const id=crypto.randomUUID(),stamp=new Date().toISOString();
  db.prepare("INSERT INTO users(id,username,display_name,password_hash,role,preferences,storage_quota_bytes,created_at,updated_at) VALUES(?,?,?,?,?,'{}',?,?,?)").run(id,`quota-${id}`,"Quota","unused","user",1024*1024,stamp,stamp);
  const pngHeader=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  const saved=await saveGeneratedImage(Buffer.concat([pngHeader,Buffer.alloc(1024)]),id);
  const source=path.join(root,"host notes.txt");await writeFile(source,"private host file");
  const imported=await saveHostFile(source,id);assert.equal(imported.metadata.mimeType,"text/plain");assert.match(imported.markdown,/download=1/);assert.equal(await readFile(imported.path,"utf8"),"private host file");
  const imageSource=path.join(root,"host image.png");await sharp({create:{width:2800,height:1800,channels:4,background:{r:30,g:90,b:160,alpha:1}}}).png().toFile(imageSource);const importedImage=await saveHostFile(imageSource,id);assert.equal(importedImage.metadata.mimeType,"image/png");assert.match(importedImage.markdown,/^!\[host image\.png\]\(\/api\/uploads\//);
  const originalBefore=await readFile(importedImage.path);const modelContent=await readUploadModelContent(importedImage.metadata.id,id,toolSettings,{visionImageMode:"max-resolution",visionMaxEdgePixels:1024});const modelImage=modelContent.find(part=>part.type==="image_file");assert.ok(modelImage&&modelImage.type==="image_file");assert.notEqual(modelImage.file_path,importedImage.path);assert.match(modelImage.file_path,/\.model-v3-1024\.jpg$/);assert.equal(modelImage.mime_type,"image/jpeg");const processedMetadata=await sharp(modelImage.file_path).metadata();assert.ok((processedMetadata.width||0)<=1024);assert.ok((processedMetadata.height||0)<=1024);const smallerContent=await readUploadModelContent(importedImage.metadata.id,id,toolSettings,{visionImageMode:"max-resolution",visionMaxEdgePixels:640});const smaller=smallerContent.find(part=>part.type==="image_file");assert.ok(smaller&&smaller.type==="image_file");assert.match(smaller.file_path,/\.model-v3-640\.jpg$/);const smallerMetadata=await sharp(smaller.file_path).metadata();assert.ok((smallerMetadata.width||0)<=640);assert.ok((smallerMetadata.height||0)<=640);const originalContent=await readUploadModelContent(importedImage.metadata.id,id,toolSettings);const originalPart=originalContent.find(part=>part.type==="image_file");assert.ok(originalPart&&originalPart.type==="image_file");assert.equal(originalPart.file_path,importedImage.path);assert.equal(originalPart.mime_type,"image/png");assert.deepEqual(await readFile(importedImage.path),originalBefore);assert.equal((await sharp(importedImage.path).metadata()).width,2800);
  const throughTool=await executeHostComputerTool(`storage:${id}`,{action:"store_file",path:source},id) as {result:{visibility:string;markdown:string;attachment:{id:string}}};assert.equal(throughTool.result.visibility,"owner-only");assert.match(throughTool.result.markdown,/download=1/);
  const visualThroughTool=await executeHostComputerTool(`storage:${id}`,{action:"store_file",path:imageSource},id,toolSettings) as {result:{loadedIntoModelContext:boolean};content?:Array<{type:string}>};assert.equal(visualThroughTool.result.loadedIntoModelContext,true);assert.equal(visualThroughTool.content?.some(part=>part.type==="image_file"),true);
  const search=await executeStorageAccessTool({action:"search",query:"host image"},id,toolSettings) as {result:{total:number;files:Array<{id:string}>}};assert.equal(search.result.total,2);
  const loaded=await executeStorageAccessTool({action:"read",file_id:importedImage.metadata.id},id,toolSettings);assert.equal(loaded.content?.some(part=>part.type==="image_file"),true);
  const otherId=crypto.randomUUID();db.prepare("INSERT INTO users(id,username,display_name,password_hash,role,preferences,storage_quota_bytes,created_at,updated_at) VALUES(?,?,?,?,?,'{}',?,?,?)").run(otherId,`other-${otherId}`,"Other","unused","user",1024*1024,stamp,stamp);await assert.rejects(executeStorageAccessTool({action:"read",file_id:importedImage.metadata.id},otherId,toolSettings),/not found/i);
  const summary=await storageSummary(id);assert.equal(summary.files.find(file=>file.id===saved.metadata.id)?.retained,true);
  const page=await storagePage(id,{page:1,pageSize:1,sort:"name_asc"});assert.equal(page.total,5);assert.equal(page.files.length,1);assert.equal(page.files[0].name,"host image.png");
  const bulkOne=await saveHostFile(source,id);const bulkTwo=await saveHostFile(source,id);await assert.rejects(moveUploadsToTrash([bulkOne.metadata.id,"missing-id"],id),/not found/i);assert.equal((await storagePage(id,{query:"host notes",state:"active"})).total,4);assert.equal(await moveUploadsToTrash([bulkOne.metadata.id,bulkTwo.metadata.id],id),2);assert.equal((await storagePage(id,{query:"host notes",state:"active"})).total,2);
  const found=await storagePage(id,{query:"host notes",state:"active"});assert.equal(found.total,2);await deleteUpload(imported.metadata.id,id);assert.equal((await storagePage(id,{query:"host notes",state:"active"})).total,1);const trashed=await storagePage(id,{query:"host notes",state:"deleted"});assert.equal(trashed.total,3);assert.ok(trashed.files.some(file=>file.id===imported.metadata.id));assert.ok(trashed.trashUsedBytes>=imported.metadata.size);await restoreUpload(imported.metadata.id,id);assert.equal((await storagePage(id,{query:"host notes",state:"active"})).total,2);
  await deleteUpload(imported.metadata.id,id);db.prepare("UPDATE uploads SET deleted_at=? WHERE id=?").run(new Date(Date.now()-61*86400_000).toISOString(),imported.metadata.id);assert.equal(await purgeDeletedUploads(id,60),1);assert.equal((await storagePage(id,{state:"deleted"})).files.some(file=>file.id===imported.metadata.id),false);
  await assert.rejects(saveGeneratedImage(Buffer.concat([pngHeader,Buffer.alloc(1024*1024)]),id),/quota exceeded/i);
});

test("storage tool writes only text formats and enforces the conversation limit",async()=>{
  const id=crypto.randomUUID(),stamp=new Date().toISOString();db.prepare("INSERT INTO users(id,username,display_name,password_hash,role,preferences,storage_quota_bytes,created_at,updated_at) VALUES(?,?,?,?,?,'{}',?,?,?)").run(id,`writer-${id}`,"Writer","unused","user",1024*1024,stamp,stamp);
  const written=await executeStorageAccessTool({action:"write",name:"notes",kind:"markdown",content:"# Hello"},id,toolSettings,{read:false,write:true,maxWrites:2,writesUsed:0}) as {result:{file:{name:string;mimeType:string};remaining:number}};
  assert.equal(written.result.file.name,"notes.md");assert.equal(written.result.file.mimeType,"text/markdown");assert.equal(written.result.remaining,1);
  const html=await executeStorageAccessTool({action:"write",name:"dashboard.html",kind:"text",content:"<h1>Hello</h1>"},id,toolSettings,{read:false,write:true,maxWrites:3,writesUsed:1}) as {result:{file:{name:string;mimeType:string}}};
  assert.equal(html.result.file.name,"dashboard.html");assert.equal(html.result.file.mimeType,"text/html");
  const extensionless=await executeStorageAccessTool({action:"write",name:"LICENSE",kind:"text",content:"Terms"},id,toolSettings,{read:false,write:true,maxWrites:3,writesUsed:2}) as {result:{file:{name:string;mimeType:string}}};
  assert.equal(extensionless.result.file.name,"LICENSE");assert.equal(extensionless.result.file.mimeType,"text/plain");
  await assert.rejects(executeStorageAccessTool({action:"write",name:"blocked",kind:"markdown",content:"x"},id,toolSettings,{read:false,write:true,maxWrites:1,writesUsed:1}),/write limit/i);
  await assert.rejects(executeStorageAccessTool({action:"write",name:"binary",kind:"html",content:"<b>x</b>"},id,toolSettings,{read:false,write:true,maxWrites:2,writesUsed:0}),/only plain text and Markdown/i);
  await assert.rejects(executeStorageAccessTool({action:"search"},id,toolSettings,{read:false,write:true,maxWrites:2}),/read access is disabled/i);
});

test.after(async()=>{db.close();await rm(root,{recursive:true,force:true});});
