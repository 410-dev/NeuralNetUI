import assert from "node:assert/strict";
import test from "node:test";
import { planCopy } from "./plan-copy.ts";
import type { UsagePlan } from "./types.ts";

test("a plan copy preserves settings but owns new identity and token windows",()=>{
  const source:UsagePlan={id:"original",name:"Pro",storageQuotaBytes:1024**3,trashQuotaBytes:2*1024**3,servedModelIds:["model"],modelWeights:{model:1.75},mcpEnabled:true,maxMcpConnections:3,artifactHtmlEnabled:false,tokenLimits:[{id:"limit-1",durationSeconds:3600,tokenLimit:100,tokenScope:"both"}],userCount:4};
  const copy=planCopy(source,["Pro","Pro (Copy)"],"en");
  assert.equal(copy.name,"Pro (Copy 2)");
  assert.equal(copy.id,"");
  assert.equal(copy.userCount,undefined);
  assert.equal(copy.tokenLimits.length,1);
  assert.notEqual(copy.tokenLimits[0].id,source.tokenLimits[0].id);
  assert.deepEqual({...copy.tokenLimits[0],id:source.tokenLimits[0].id},source.tokenLimits[0]);
  assert.equal(copy.artifactHtmlEnabled,false);
  copy.modelWeights.model=2;
  assert.equal(source.modelWeights.model,1.75);
  const long=planCopy({...source,name:"P".repeat(80)},[],"ko");
  assert.ok(long.name.length<=80);
});
