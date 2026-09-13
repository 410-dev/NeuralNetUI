import { createReadStream, existsSync, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { authErrorResponse, listUsers, logAdminAudit, requireAuditor } from "@/lib/auth";
import { listConversationsPage, listManagedConversationIds, permanentlyDeleteConversation, purgeExpiredConversations, readManagedConversation, restoreConversation } from "@/lib/conversations";
import { managedStorageFiles, permanentlyDeleteUpload, purgeDeletedUploads, readManagedUpload, restoreUpload, storagePage, type StorageSort } from "@/lib/uploads";
import { readConfig } from "@/lib/config";
import { createZipArchive, type ZipEntry } from "@/lib/zip-archive";

export const runtime="nodejs";export const dynamic="force-dynamic";
type Context={params:Promise<{id:string}>};
const jsonEntry=(name:string,value:unknown):ZipEntry=>({name,data:Buffer.from(JSON.stringify(value,null,2),"utf8")});
const disposition=(name:string)=>`attachment; filename*=UTF-8''${encodeURIComponent(name)}`;
const positive=(value:string|null,fallback:number)=>{const number=Number(value);return Number.isSafeInteger(number)&&number>0?number:fallback;};
const auditState=(value:string|null):"all"|"active"|"deleted"=>value==="active"||value==="deleted"?value:"all";

async function contextFor(request:Request,context:Context){
  const actor=requireAuditor(request);const{id}=await context.params;const target=listUsers().find(user=>user.id===id);if(!target)throw Object.assign(new Error("User not found."),{status:404});
  const config=await readConfig();await purgeExpiredConversations(id,config.userStorageSettings.trashRetentionDays);await purgeDeletedUploads(id,config.userStorageSettings.trashRetentionDays);return{actor,id,target};
}

export async function GET(request:Request,context:Context){
  try{
    const{actor,id,target}=await contextFor(request,context);const query=new URL(request.url).searchParams;const download=query.get("download");
    if(!download){
      const view=query.get("view")||"summary";
      if(view==="conversations"){const result=await listConversationsPage(id,{page:positive(query.get("page"),1),pageSize:10,query:String(query.get("q")||""),state:auditState(query.get("state"))});logAdminAudit(actor.id,id,"user.audit.conversations.inspect",JSON.stringify({page:result.page,query:result.query,state:result.state}));return Response.json(result);}
      if(view==="files"){const result=await storagePage(id,{page:positive(query.get("page"),1),pageSize:positive(query.get("pageSize"),24),sort:String(query.get("sort")||"created_desc") as StorageSort,query:String(query.get("q")||""),state:auditState(query.get("state"))});logAdminAudit(actor.id,id,"user.audit.files.inspect",JSON.stringify({page:result.page,query:result.query,state:result.state,sort:result.sort}));return Response.json(result);}
      if(view==="conversation"){const conversationId=String(query.get("conversationId")||"");const conversation=await readManagedConversation(conversationId,id);if(!conversation)return Response.json({error:"Conversation not found."},{status:404});logAdminAudit(actor.id,id,"user.audit.conversation.inspect",conversationId);return Response.json({conversation});}
      if(view!=="summary")return Response.json({error:"Unsupported audit view."},{status:400});
      logAdminAudit(actor.id,id,"user.audit.inspect");return Response.json({user:target});
    }
    if(download==="media-file"){
      const uploadId=String(query.get("uploadId")||"");const{metadata,paths}=await readManagedUpload(uploadId,id);const thumbnail=query.get("variant")==="thumbnail"&&metadata.mimeType.startsWith("image/")&&existsSync(paths.thumbnail);const safeInline=thumbnail||metadata.mimeType.startsWith("image/")||metadata.mimeType==="application/pdf";const inline=query.get("inline")==="1"&&safeInline;if(!inline)logAdminAudit(actor.id,id,"user.audit.media.download",uploadId);const stream=createReadStream(thumbnail?paths.thumbnail:paths.original);return new Response(Readable.toWeb(stream) as ReadableStream,{headers:{"Content-Type":thumbnail?"image/jpeg":metadata.mimeType,"Content-Disposition":inline?`inline; filename*=UTF-8''${encodeURIComponent(metadata.name)}`:disposition(metadata.name),"X-Content-Type-Options":"nosniff","Cache-Control":"private, no-store","Vary":"Cookie"}});
    }
    let entries:ZipEntry[]=[];let filename="export.zip";
    if(download==="conversation"){
      const conversationId=String(query.get("conversationId")||"");const conversation=await readManagedConversation(conversationId,id);if(!conversation)return Response.json({error:"Conversation not found."},{status:404});entries=[jsonEntry(`${conversation.title}-${conversation.id}.json`,conversation)];filename=`conversation-${conversation.id}.zip`;logAdminAudit(actor.id,id,"user.audit.conversation.export",conversationId);
    }else if(download==="conversations"){
      const ids=await listManagedConversationIds(id);const conversations=await Promise.all(ids.map(conversationId=>readManagedConversation(conversationId,id)));entries=conversations.filter(Boolean).map(item=>jsonEntry(`conversations/${item!.id}.json`,item));filename=`${target.username}-conversations.zip`;logAdminAudit(actor.id,id,"user.audit.conversations.export",String(entries.length));
    }else if(download==="media"){
      const files=await managedStorageFiles(id);for(const file of files){const{paths}=await readManagedUpload(file.id,id);entries.push({name:`media/${file.id}-${file.name}`,path:paths.original});}filename=`${target.username}-media.zip`;logAdminAudit(actor.id,id,"user.audit.media.export",String(entries.length));
    }else return Response.json({error:"Unsupported export."},{status:400});
    const archive=await createZipArchive(entries);const stream=createReadStream(archive.path);stream.once("close",()=>void fs.rm(archive.directory,{recursive:true,force:true}));return new Response(Readable.toWeb(stream) as ReadableStream,{headers:{"Content-Type":"application/zip","Content-Length":String(archive.size),"Content-Disposition":disposition(filename),"X-Content-Type-Options":"nosniff","Cache-Control":"no-store"}});
  }catch(error){if((error as {status?:number}).status===404)return Response.json({error:"User not found."},{status:404});return authErrorResponse(error);}
}

export async function PATCH(request:Request,context:Context){
  try{const{actor,id}=await contextFor(request,context);const body=await request.json();const resource=String(body.resource||"");const resourceId=String(body.id||"");if(body.action!=="restore")return Response.json({error:"Unsupported audit action."},{status:400});if(resource==="conversation")await restoreConversation(resourceId,id);else if(resource==="file")await restoreUpload(resourceId,id);else return Response.json({error:"Unsupported audit resource."},{status:400});logAdminAudit(actor.id,id,`user.audit.${resource}.restore`,resourceId);return Response.json({restored:true});}catch(error){return authErrorResponse(error);}
}

export async function DELETE(request:Request,context:Context){
  try{const{actor,id}=await contextFor(request,context);const body=await request.json();const resource=String(body.resource||"");const resourceId=String(body.id||"");if(resource==="conversation")await permanentlyDeleteConversation(resourceId,id);else if(resource==="file")await permanentlyDeleteUpload(resourceId,id);else return Response.json({error:"Unsupported audit resource."},{status:400});logAdminAudit(actor.id,id,`user.audit.${resource}.purge`,resourceId);return new Response(null,{status:204});}catch(error){return authErrorResponse(error);}
}
