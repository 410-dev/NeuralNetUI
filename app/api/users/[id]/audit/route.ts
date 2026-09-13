import { createReadStream, existsSync, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { authErrorResponse, listUsers, logAdminAudit, requireAdmin } from "@/lib/auth";
import { listConversations, listConversationsPage, readConversation } from "@/lib/conversations";
import { readManagedUpload, storagePage, storageSummary, type StorageSort } from "@/lib/uploads";
import { createZipArchive, type ZipEntry } from "@/lib/zip-archive";

export const runtime="nodejs";export const dynamic="force-dynamic";
type Context={params:Promise<{id:string}>};
const jsonEntry=(name:string,value:unknown):ZipEntry=>({name,data:Buffer.from(JSON.stringify(value,null,2),"utf8")});
const disposition=(name:string)=>`attachment; filename*=UTF-8''${encodeURIComponent(name)}`;
const positive=(value:string|null,fallback:number)=>{const number=Number(value);return Number.isSafeInteger(number)&&number>0?number:fallback;};

export async function GET(request:Request,context:Context){
  try{
    const actor=requireAdmin(request);const{id}=await context.params;const target=listUsers().find(user=>user.id===id);if(!target)return Response.json({error:"User not found."},{status:404});
    const query=new URL(request.url).searchParams;const download=query.get("download");
    if(!download){
      const view=query.get("view")||"summary";
      if(view==="conversations"){const result=await listConversationsPage(id,{page:positive(query.get("page"),1),pageSize:positive(query.get("pageSize"),20)});logAdminAudit(actor.id,id,"user.audit.conversations.inspect",String(result.page));return Response.json(result);}
      if(view==="files"){const result=await storagePage(id,{page:positive(query.get("page"),1),pageSize:positive(query.get("pageSize"),24),sort:String(query.get("sort")||"created_desc") as StorageSort});logAdminAudit(actor.id,id,"user.audit.files.inspect",`${result.page}:${result.sort}`);return Response.json(result);}
      if(view==="conversation"){const conversationId=String(query.get("conversationId")||"");const conversation=await readConversation(conversationId,id);if(!conversation)return Response.json({error:"Conversation not found."},{status:404});logAdminAudit(actor.id,id,"user.audit.conversation.inspect",conversationId);return Response.json({conversation});}
      if(view!=="summary")return Response.json({error:"Unsupported audit view."},{status:400});
      logAdminAudit(actor.id,id,"user.audit.inspect");return Response.json({user:target});
    }
    if(download==="media-file"){
      const uploadId=String(query.get("uploadId")||"");const{metadata,paths}=await readManagedUpload(uploadId,id);const thumbnail=query.get("variant")==="thumbnail"&&metadata.mimeType.startsWith("image/")&&existsSync(paths.thumbnail);const safeInline=thumbnail||metadata.mimeType.startsWith("image/")||metadata.mimeType==="application/pdf";const inline=query.get("inline")==="1"&&safeInline;if(!inline)logAdminAudit(actor.id,id,"user.audit.media.download",uploadId);const stream=createReadStream(thumbnail?paths.thumbnail:paths.original);return new Response(Readable.toWeb(stream) as ReadableStream,{headers:{"Content-Type":thumbnail?"image/jpeg":metadata.mimeType,"Content-Disposition":inline?`inline; filename*=UTF-8''${encodeURIComponent(metadata.name)}`:disposition(metadata.name),"X-Content-Type-Options":"nosniff","Cache-Control":"private, no-store","Vary":"Cookie"}});
    }
    let entries:ZipEntry[]=[];let filename="export.zip";
    if(download==="conversation"){
      const conversationId=String(query.get("conversationId")||"");const conversation=await readConversation(conversationId,id);if(!conversation)return Response.json({error:"Conversation not found."},{status:404});entries=[jsonEntry(`${conversation.title}-${conversation.id}.json`,conversation)];filename=`conversation-${conversation.id}.zip`;logAdminAudit(actor.id,id,"user.audit.conversation.export",conversationId);
    }else if(download==="conversations"){
      const summaries=await listConversations(id);const conversations=await Promise.all(summaries.map(item=>readConversation(item.id,id)));entries=conversations.filter(Boolean).map(item=>jsonEntry(`conversations/${item!.id}.json`,item));filename=`${target.username}-conversations.zip`;logAdminAudit(actor.id,id,"user.audit.conversations.export",String(entries.length));
    }else if(download==="media"){
      const storage=await storageSummary(id);for(const file of storage.files){const{paths}=await readManagedUpload(file.id,id);entries.push({name:`media/${file.id}-${file.name}`,path:paths.original});}filename=`${target.username}-media.zip`;logAdminAudit(actor.id,id,"user.audit.media.export",String(entries.length));
    }else return Response.json({error:"Unsupported export."},{status:400});
    const archive=await createZipArchive(entries);const stream=createReadStream(archive.path);stream.once("close",()=>void fs.rm(archive.directory,{recursive:true,force:true}));return new Response(Readable.toWeb(stream) as ReadableStream,{headers:{"Content-Type":"application/zip","Content-Length":String(archive.size),"Content-Disposition":disposition(filename),"X-Content-Type-Options":"nosniff","Cache-Control":"no-store"}});
  }catch(error){return authErrorResponse(error);}
}
