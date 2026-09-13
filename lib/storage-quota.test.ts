import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const root=await mkdtemp(path.join(os.tmpdir(),"neural-storage-test-"));
process.env.NEURAL_CHAT_DATA_DIR=root;
const {db}=await import("./database.ts");
const {saveGeneratedImage,saveHostFile,storagePage,storageSummary}=await import("./uploads.ts");
const {executeHostComputerTool}=await import("./host-computer-tool.ts");

test("user storage quota is enforced atomically and generated images are retained",async()=>{
  const id=crypto.randomUUID(),stamp=new Date().toISOString();
  db.prepare("INSERT INTO users(id,username,display_name,password_hash,role,preferences,storage_quota_bytes,created_at,updated_at) VALUES(?,?,?,?,?,'{}',?,?,?)").run(id,`quota-${id}`,"Quota","unused","user",1024*1024,stamp,stamp);
  const pngHeader=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  const saved=await saveGeneratedImage(Buffer.concat([pngHeader,Buffer.alloc(1024)]),id);
  const source=path.join(root,"host notes.txt");await writeFile(source,"private host file");
  const imported=await saveHostFile(source,id);assert.equal(imported.metadata.mimeType,"text/plain");assert.match(imported.markdown,/download=1/);assert.equal(await readFile(imported.path,"utf8"),"private host file");
  const imageSource=path.join(root,"host image.png");await sharp({create:{width:4,height:3,channels:4,background:{r:30,g:90,b:160,alpha:1}}}).png().toFile(imageSource);const importedImage=await saveHostFile(imageSource,id);assert.equal(importedImage.metadata.mimeType,"image/png");assert.match(importedImage.markdown,/^!\[host image\.png\]\(\/api\/uploads\//);
  const throughTool=await executeHostComputerTool(`storage:${id}`,{action:"store_file",path:source},id) as {result:{visibility:string;markdown:string;attachment:{id:string}}};assert.equal(throughTool.result.visibility,"owner-only");assert.match(throughTool.result.markdown,/download=1/);
  const summary=await storageSummary(id);assert.equal(summary.files.find(file=>file.id===saved.metadata.id)?.retained,true);
  const page=await storagePage(id,{page:1,pageSize:1,sort:"name_asc"});assert.equal(page.total,4);assert.equal(page.files.length,1);assert.equal(page.files[0].name,"host image.png");
  await assert.rejects(saveGeneratedImage(Buffer.concat([pngHeader,Buffer.alloc(1024*1024)]),id),/quota exceeded/i);
});

test.after(async()=>{db.close();await rm(root,{recursive:true,force:true});});
