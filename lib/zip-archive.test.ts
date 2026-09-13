import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createZipArchive } from "./zip-archive.ts";

test("ZIP exports preserve in-memory records and streamed media names", async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"neural-zip-test-"));
  try{
    const media=path.join(root,"large image.png");await writeFile(media,Buffer.from("stored-media"));
    const archive=await createZipArchive([{name:"conversations/chat.json",data:Buffer.from(JSON.stringify({messages:Array(100).fill("compressible chat record")}))},{name:"media/large image.png",path:media}]);
    const bytes=await readFile(archive.path);assert.equal(bytes.readUInt32LE(0),0x04034b50);assert.equal(bytes.readUInt16LE(8),8);assert.ok(bytes.readUInt32LE(18)<bytes.readUInt32LE(22));assert.equal(bytes.readUInt32LE(bytes.length-22),0x06054b50);assert.match(bytes.toString("utf8"),/conversations\/chat\.json/);assert.match(bytes.toString("utf8"),/media\/large image\.png/);
    await rm(archive.directory,{recursive:true,force:true});
  }finally{await rm(root,{recursive:true,force:true});}
});
