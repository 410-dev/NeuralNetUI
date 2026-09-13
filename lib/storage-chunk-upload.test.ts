import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root=await mkdtemp(path.join(os.tmpdir(),"neural-chunk-upload-test-"));
process.env.NEURAL_CHAT_DATA_DIR=root;
const{db}=await import("./database.ts");
const{beginStorageUpload,completeStorageUpload,STORAGE_UPLOAD_CHUNK_BYTES,writeStorageUploadChunk}=await import("./storage-chunk-upload.ts");
const{readUpload,saveTextFile}=await import("./uploads.ts");

function addUser(label:string){const id=crypto.randomUUID(),stamp=new Date().toISOString();db.prepare("INSERT INTO users(id,username,display_name,password_hash,role,preferences,storage_quota_bytes,created_at,updated_at) VALUES(?,?,?,?,?,'{}',?,?,?)").run(id,`${label}-${id}`,label,"unused","user",32*1024*1024,stamp,stamp);return id;}

test("assembles owner-scoped multi-chunk uploads and accepts idempotent retries",async()=>{
  const owner=addUser("owner"),other=addUser("other"),tail=Buffer.from("chunk tail"),head=Buffer.alloc(STORAGE_UPLOAD_CHUNK_BYTES,7);const session=await beginStorageUpload({name:"large notes.bin",size:head.length+tail.length},owner);
  assert.equal(session.totalChunks,2);await writeStorageUploadChunk(session.id,0,owner,head);await writeStorageUploadChunk(session.id,0,owner,head);await assert.rejects(writeStorageUploadChunk(session.id,1,other,tail),/not found/i);await writeStorageUploadChunk(session.id,1,owner,tail);
  const saved=await completeStorageUpload(session.id,owner);const{paths}=await readUpload(saved.id,owner);const data=await readFile(paths.original);assert.equal(data.length,head.length+tail.length);assert.deepEqual(data.subarray(-tail.length),tail);assert.equal((await completeStorageUpload(session.id,owner)).id,saved.id);
});

test("rejects missing or malformed chunks and creates normalized UTF-8 text files",async()=>{
  const owner=addUser("validation"),session=await beginStorageUpload({name:"missing.bin",size:STORAGE_UPLOAD_CHUNK_BYTES+1},owner);await assert.rejects(beginStorageUpload({name:"over-reserved.bin",size:24*1024*1024},owner),/remaining storage/i);await writeStorageUploadChunk(session.id,0,owner,Buffer.alloc(STORAGE_UPLOAD_CHUNK_BYTES));await assert.rejects(completeStorageUpload(session.id,owner),/chunk 2 is missing/i);await assert.rejects(writeStorageUploadChunk(session.id,1,owner,Buffer.alloc(2)),/invalid size/i);
  const text=await saveTextFile("folder\\notes.txt","markdown","# 안녕하세요",owner);assert.equal(text.name,"folder-notes.md");assert.equal(text.mimeType,"text/markdown");const{paths}=await readUpload(text.id,owner);assert.equal(await readFile(paths.original,"utf8"),"# 안녕하세요");
});

test.after(async()=>{db.close();await rm(root,{recursive:true,force:true});});
