import type { UsagePlan } from "./types.ts";
import { createClientId } from "./client-id.ts";

/** A copy has independent token-window rows and starts without assigned users. */
export function planCopy(source:UsagePlan, existingNames:string[], language:"ko"|"en"):UsagePlan {
  const suffix=language==="ko"?"복사본":"Copy";
  const base=source.name.trim().slice(0,Math.max(1,77-suffix.length)).trimEnd();
  const names=new Set(existingNames.map(name=>name.toLocaleLowerCase()));
  let name=`${base} (${suffix})`,number=2;
  while(names.has(name.toLocaleLowerCase())){
    const tail=` (${suffix} ${number++})`;
    name=`${source.name.trim().slice(0,80-tail.length).trimEnd()}${tail}`;
  }
  return {...structuredClone(source),id:"",name,userCount:undefined,tokenLimits:source.tokenLimits.map(({durationSeconds,tokenLimit,tokenScope})=>({id:createClientId("limit"),durationSeconds,tokenLimit,tokenScope}))};
}
