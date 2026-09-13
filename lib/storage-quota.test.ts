import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root=await mkdtemp(path.join(os.tmpdir(),"neural-storage-test-"));
process.env.NEURAL_CHAT_DATA_DIR=root;
const {db}=await import("./database.ts");
const {saveGeneratedImage,storageSummary}=await import("./uploads.ts");

test("user storage quota is enforced atomically and generated images are retained",async()=>{
  const id=crypto.randomUUID(),stamp=new Date().toISOString();
  db.prepare("INSERT INTO users(id,username,display_name,password_hash,role,preferences,storage_quota_bytes,created_at,updated_at) VALUES(?,?,?,?,?,'{}',?,?,?)").run(id,`quota-${id}`,"Quota","unused","user",1024*1024,stamp,stamp);
  const pngHeader=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  const saved=await saveGeneratedImage(Buffer.concat([pngHeader,Buffer.alloc(1024)]),id);
  const summary=await storageSummary(id);assert.equal(summary.files[0].id,saved.metadata.id);assert.equal(summary.files[0].retained,true);
  await assert.rejects(saveGeneratedImage(Buffer.concat([pngHeader,Buffer.alloc(1024*1024)]),id),/quota exceeded/i);
});

test.after(async()=>{db.close();await rm(root,{recursive:true,force:true});});
