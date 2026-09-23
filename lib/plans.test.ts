import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("response-admission release reports whether the target account's lock existed",async()=>{
  const source=await readFile(new URL("./plans.ts",import.meta.url),"utf8");
  assert.match(source,/DELETE FROM token_usage_admissions WHERE user_id=\?/);
  assert.match(source,/releasePlanAdmission\(userId:string\)\{return db\.prepare\([^)]*\)\.run\(userId\)\.changes>0;\}/);
});

test("response-admission release API requires an administrator and records the action",async()=>{
  const source=await readFile(new URL("../app/api/users/[id]/response-admission/route.ts",import.meta.url),"utf8");
  assert.match(source,/requireAdmin\(request\)/);
  assert.match(source,/releasePlanAdmission\(id\)/);
  assert.match(source,/logAdminAudit\(actor\.id,id,"user\.response-admission\.release"/);
});
