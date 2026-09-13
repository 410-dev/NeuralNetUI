import { createReadStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { authErrorResponse, listUsers, logAdminAudit, requireAdmin } from "@/lib/auth";
import { listConversations, readConversation } from "@/lib/conversations";
import { readManagedUpload, storageSummary } from "@/lib/uploads";
import { createZipArchive, type ZipEntry } from "@/lib/zip-archive";

export const runtime="nodejs";export const dynamic="force-dynamic";
type Context={params:Promise<{id:string}>};
const jsonEntry=(name:string,value:unknown):ZipEntry=>({name,data:Buffer.from(JSON.stringify(value,null,2),"utf8")});
const disposition=(name:string)=>`attachment; filename*=UTF-8''${encodeURIComponent(name)}`;

export async function GET(request:Request,context:Context){
  try{
    const actor=requireAdmin(request);const{id}=await context.params;const target=listUsers().find(user=>user.id===id);if(!target)return Response.json({error:"User not found."},{status:404});
    const query=new URL(request.url).searchParams;const download=query.get("download");
    if(!download){const[conversations,storage]=await Promise.all([listConversations(id),storageSummary(id)]);logAdminAudit(actor.id,id,"user.audit.inspect");return Response.json({user:target,conversations,storage});}
    if(download==="media-file"){
      const uploadId=String(query.get("uploadId")||"");const{metadata,paths}=await readManagedUpload(uploadId,id);const inline=query.get("inline")==="1";if(!inline)logAdminAudit(actor.id,id,"user.audit.media.download",uploadId);const stream=createReadStream(paths.original);return new Response(Readable.toWeb(stream) as ReadableStream,{headers:{"Content-Type":metadata.mimeType,"Content-Disposition":inline?`inline; filename*=UTF-8''${encodeURIComponent(metadata.name)}`:disposition(metadata.name),"X-Content-Type-Options":"nosniff","Cache-Control":"private, no-store"}});
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
