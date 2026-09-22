import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root=await mkdtemp(path.join(os.tmpdir(),"neural-chunk-upload-test-"));
process.env.NEURAL_CHAT_DATA_DIR=root;
const{db}=await import("./database.ts");
const{beginStorageUpload,completeStorageUpload,STORAGE_UPLOAD_CHUNK_BYTES,writeStorageUploadChunk}=await import("./storage-chunk-upload.ts");
const{readUpload,renameStoredFile,replaceStoredTextFile,saveArtifactFile,saveTextFile}=await import("./uploads.ts");

function addUser(label:string){const id=crypto.randomUUID(),stamp=new Date().toISOString();db.prepare("INSERT INTO users(id,username,display_name,password_hash,role,preferences,storage_quota_bytes,created_at,updated_at) VALUES(?,?,?,?,?,'{}',?,?,?)").run(id,`${label}-${id}`,label,"unused","user",32*1024*1024,stamp,stamp);return id;}
function addConversation(userId:string){const id=crypto.randomUUID(),branchId=crypto.randomUUID(),stamp=new Date().toISOString();db.transaction(()=>{db.prepare("INSERT INTO conversations(id,title,model_id,active_branch_id,created_at,updated_at,user_id) VALUES(?,?,?,?,?,?,?)").run(id,"Artifact test","model",branchId,stamp,stamp,userId);db.prepare("INSERT INTO branches(id,conversation_id,name,position,created_at,updated_at) VALUES(?,?,?,0,?,?)").run(branchId,id,"Main",stamp,stamp);})();return id;}

test("assembles owner-scoped multi-chunk uploads and accepts idempotent retries",async()=>{
  const owner=addUser("owner"),other=addUser("other"),tail=Buffer.from("chunk tail"),head=Buffer.alloc(STORAGE_UPLOAD_CHUNK_BYTES,7);const session=await beginStorageUpload({name:"large notes.bin",size:head.length+tail.length},owner);
  assert.equal(session.totalChunks,2);await writeStorageUploadChunk(session.id,0,owner,head);await writeStorageUploadChunk(session.id,0,owner,head);await assert.rejects(writeStorageUploadChunk(session.id,1,other,tail),/not found/i);await writeStorageUploadChunk(session.id,1,owner,tail);
  const saved=await completeStorageUpload(session.id,owner);const{paths}=await readUpload(saved.id,owner);const data=await readFile(paths.original);assert.equal(data.length,head.length+tail.length);assert.deepEqual(data.subarray(-tail.length),tail);assert.equal((await completeStorageUpload(session.id,owner)).id,saved.id);
});

test("rejects missing or malformed chunks and creates normalized UTF-8 text files",async()=>{
  const owner=addUser("validation"),session=await beginStorageUpload({name:"missing.bin",size:STORAGE_UPLOAD_CHUNK_BYTES+1},owner);await assert.rejects(beginStorageUpload({name:"over-reserved.bin",size:24*1024*1024},owner),/remaining storage/i);await writeStorageUploadChunk(session.id,0,owner,Buffer.alloc(STORAGE_UPLOAD_CHUNK_BYTES));await assert.rejects(completeStorageUpload(session.id,owner),/chunk 2 is missing/i);await assert.rejects(writeStorageUploadChunk(session.id,1,owner,Buffer.alloc(2)),/invalid size/i);
  const text=await saveTextFile("folder\\notes.txt","markdown","# 안녕하세요",owner);assert.equal(text.name,"folder-notes.md");assert.equal(text.mimeType,"text/markdown");const{paths}=await readUpload(text.id,owner);assert.equal(await readFile(paths.original,"utf8"),"# 안녕하세요");
});

test("atomically updates editable owner-scoped files and their recorded size",async()=>{
  const owner=addUser("editor"),other=addUser("other-editor"),saved=await saveTextFile("draft","markdown","old",owner),next="# 새 내용\n";
  const updated=await replaceStoredTextFile(saved.id,owner,next);const{paths}=await readUpload(saved.id,owner);
  assert.equal(updated.size,Buffer.byteLength(next));assert.equal(await readFile(paths.original,"utf8"),next);
  const renamed=await renameStoredFile(saved.id,owner,"report.json");assert.equal(renamed.name,"report.json");assert.equal(renamed.mimeType,"application/json");
  await assert.rejects(replaceStoredTextFile(saved.id,other,"not allowed"),/not found/i);
  await assert.rejects(renameStoredFile(saved.id,other,"stolen.json"),/not found/i);
});

test("artifact storage overwrites within one conversation and suffixes collisions across conversations",async()=>{
  const owner=addUser("artifact-owner"),firstConversation=addConversation(owner),secondConversation=addConversation(owner),thirdConversation=addConversation(owner);
  const first=await saveArtifactFile("보고서.md","markdown","version one",owner,firstConversation);
  assert.equal(first.fileName,"보고서.md");assert.equal(first.nameChanged,false);assert.equal(first.action,"created");
  const updated=await saveArtifactFile("보고서.md","markdown","version two",owner,firstConversation);
  assert.equal(updated.attachment.id,first.attachment.id);assert.equal(updated.fileName,"보고서.md");assert.equal(updated.action,"updated");
  const{paths}=await readUpload(first.attachment.id,owner);assert.equal(await readFile(paths.original,"utf8"),"version two");
  const collision=await saveArtifactFile("보고서.md","markdown","another chat",owner,secondConversation);
  assert.notEqual(collision.attachment.id,first.attachment.id);assert.equal(collision.fileName,"보고서 (1).md");assert.equal(collision.requestedName,"보고서.md");assert.equal(collision.nameChanged,true);
  const nextCollision=await saveArtifactFile("보고서.md","markdown","third chat",owner,thirdConversation);
  assert.equal(nextCollision.fileName,"보고서 (2).md");
  const html=await saveArtifactFile("dashboard","html","<!doctype html>",owner,firstConversation);
  assert.equal(html.fileName,"dashboard.html");assert.equal(html.attachment.mimeType,"text/html");
});

test.after(async()=>{db.close();await rm(root,{recursive:true,force:true});});
