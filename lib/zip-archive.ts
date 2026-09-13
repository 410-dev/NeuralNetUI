import { createReadStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";

export type ZipEntry={name:string;data?:Buffer;path?:string};
const table=Array.from({length:256},(_,n)=>{let value=n;for(let bit=0;bit<8;bit++)value=(value&1)?0xedb88320^(value>>>1):value>>>1;return value>>>0;});
const updateCrc=(crc:number,chunk:Buffer)=>{let value=crc;for(const byte of chunk)value=table[(value^byte)&0xff]^(value>>>8);return value;};
const safeName=(value:string)=>value.replace(/\\/g,"/").split("/").filter(part=>part&&part!=="."&&part!=="..").join("/").replace(/[\0-\x1f:*?"<>|]/g,"_").slice(0,500)||"file";
const uint16=(buffer:Buffer,offset:number,value:number)=>buffer.writeUInt16LE(value&0xffff,offset);
const uint32=(buffer:Buffer,offset:number,value:number)=>buffer.writeUInt32LE(value>>>0,offset);

async function entryInfo(entry:ZipEntry){
  if(entry.data){let crc=0xffffffff;crc=updateCrc(crc,entry.data);const payload=deflateRawSync(entry.data);return{size:entry.data.length,compressedSize:payload.length,crc:(crc^0xffffffff)>>>0,method:8,payload};}
  if(!entry.path)throw new Error("ZIP entry has no content.");
  const stats=await fs.stat(entry.path);let crc=0xffffffff;
  for await(const chunk of createReadStream(entry.path))crc=updateCrc(crc,chunk as Buffer);
  return{size:stats.size,compressedSize:stats.size,crc:(crc^0xffffffff)>>>0,method:0,payload:undefined};
}

/** Deflates JSON records and streams already-compressed media without holding it in memory. */
export async function createZipArchive(entries:ZipEntry[]){
  if(entries.length>0xffff)throw new Error("The export contains too many files for ZIP32.");
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),"neural-chat-export-"));const output=path.join(directory,"export.zip");const handle=await fs.open(output,"wx",0o600);let position=0;
  const central:Array<{name:Buffer;size:number;compressedSize:number;crc:number;method:number;offset:number}>=[];
  try{
    for(const entry of entries){
      const name=Buffer.from(safeName(entry.name),"utf8");const info=await entryInfo(entry);if(info.size>0xffffffff)throw new Error("A single export file exceeds the ZIP32 limit.");
      const header=Buffer.alloc(30);uint32(header,0,0x04034b50);uint16(header,4,20);uint16(header,6,0x0800);uint16(header,8,info.method);uint32(header,14,info.crc);uint32(header,18,info.compressedSize);uint32(header,22,info.size);uint16(header,26,name.length);
      const offset=position;await handle.write(header,0,header.length,position);position+=header.length;await handle.write(name,0,name.length,position);position+=name.length;
      if(info.payload){await handle.write(info.payload,0,info.payload.length,position);position+=info.payload.length;}else if(entry.path){for await(const chunk of createReadStream(entry.path)){const data=chunk as Buffer;await handle.write(data,0,data.length,position);position+=data.length;}}
      if(position>0xffffffff)throw new Error("The export exceeds the ZIP32 size limit.");
      central.push({name,size:info.size,compressedSize:info.compressedSize,crc:info.crc,method:info.method,offset});
    }
    const centralStart=position;
    for(const entry of central){const header=Buffer.alloc(46);uint32(header,0,0x02014b50);uint16(header,4,20);uint16(header,6,20);uint16(header,8,0x0800);uint16(header,10,entry.method);uint32(header,16,entry.crc);uint32(header,20,entry.compressedSize);uint32(header,24,entry.size);uint16(header,28,entry.name.length);uint32(header,42,entry.offset);await handle.write(header,0,header.length,position);position+=header.length;await handle.write(entry.name,0,entry.name.length,position);position+=entry.name.length;}
    const end=Buffer.alloc(22);uint32(end,0,0x06054b50);uint16(end,8,central.length);uint16(end,10,central.length);uint32(end,12,position-centralStart);uint32(end,16,centralStart);await handle.write(end,0,end.length,position);
    return{path:output,directory,size:position+end.length};
  }catch(error){await handle.close();await fs.rm(directory,{recursive:true,force:true});throw error;}finally{await handle.close().catch(()=>undefined);}
}
