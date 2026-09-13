import { db } from "./database";

declare global {
  var neuralRetentionTimer: ReturnType<typeof setInterval> | undefined;
  var neuralRetentionRun: Promise<void> | undefined;
}

export function runRetentionMaintenance(){
  globalThis.neuralRetentionRun??=(async()=>{const[{readConfig},{purgeExpiredConversations},{purgeDeletedUploads}]=await Promise.all([import("./config"),import("./conversations"),import("./uploads")]);const config=await readConfig();const users=db.prepare("SELECT id FROM users").all() as Array<{id:string}>;for(const user of users){await purgeExpiredConversations(user.id,config.userStorageSettings.trashRetentionDays);await purgeDeletedUploads(user.id,config.userStorageSettings.trashRetentionDays);}})().catch(error=>console.error("Retention maintenance failed",error)).finally(()=>{globalThis.neuralRetentionRun=undefined;});return globalThis.neuralRetentionRun;
}

export function ensureRetentionMaintenanceScheduled(){
  if(globalThis.neuralRetentionTimer)return;void runRetentionMaintenance();const timer=setInterval(()=>void runRetentionMaintenance(),60_000);timer.unref?.();globalThis.neuralRetentionTimer=timer;
}
