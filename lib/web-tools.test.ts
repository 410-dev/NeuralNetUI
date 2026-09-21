import assert from "node:assert/strict";
import test from "node:test";

import { pageVisitHeaders } from "./page-visit-request.ts";
import { executeWebTool,toolDefinitions } from "./web-tools.ts";

test("page visits identify NeuralChat with a browser-compatible user agent", () => {
  const headers = pageVisitHeaders();

  assert.match(headers["User-Agent"], /^Mozilla\/5\.0 .* AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/\d+\.0\.0\.0 Safari\/537\.36 NeuralChat\/\d+\.\d+\.\d+(?:[-.][0-9A-Za-z]+)*$/);
  assert.match(headers.Accept, /text\/html/);
  assert.match(headers["Accept-Language"], /en-US/);
});

test("artifact tool advertises and returns bounded structured artifacts",async()=>{
  const settings={maxToolRounds:8,maxBrowserTabs:8,maxMultipleChoiceQuestions:3,maxAttachmentsPerMessage:12,textDownloadLimitMb:1,textCharacterLimit:24_000,imageDownloadLimitMb:10,imageUploadLimitMb:20,pdfSizeLimitMb:25,pdfPageLimit:100,pdfTextCharacterLimit:100_000,pdfVisionPageLimit:6,pdfProcessingTimeoutSeconds:30,temporaryFileTtlMinutes:60,orphanUploadTtlHours:24};
  assert.ok(toolDefinitions({artifact:true},settings).some(item=>(item.function as {name?:string}).name==="create_artifact"));
  const result=await executeWebTool("create_artifact",JSON.stringify({title:"Metrics",kind:"csv",content:"name,value\nA,1"}),{artifact:true},settings);
  assert.deepEqual((result.result as {artifact:{title:string;kind:string;content:string}}).artifact,{title:"Metrics",kind:"csv",content:"name,value\nA,1",updatedAt:(result.result as {artifact:{updatedAt:string}}).artifact.updatedAt});
});
