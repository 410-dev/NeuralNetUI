import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const calls=[];
const mock=http.createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk;
 const body=raw?JSON.parse(raw):{};
 res.setHeader('Content-Type','application/json');
 if(req.url!=='/v1/chat/completions'){res.statusCode=404;return res.end('{}');}
 calls.push(body);
 if(!body.stream)return res.end(JSON.stringify({choices:[{message:{content:body.messages[0].content==='TITLE'?'Generated title':'Earlier facts retained in summary.'},finish_reason:'stop'}]}));
 res.setHeader('Content-Type','text/event-stream');
 res.end(`data: ${JSON.stringify({choices:[{delta:{content:'Answer'},finish_reason:'stop'}],usage:{prompt_tokens:90,completion_tokens:10,total_tokens:100}})}\n\ndata: [DONE]\n\n`);
});
mock.listen(0,'127.0.0.1');await once(mock,'listening');
const data=await mkdtemp(path.join(os.tmpdir(),'neural-harness-'));
const port=Number(process.env.HARNESS_TEST_PORT || 32197);const root=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{env:{...process.env,NEURAL_CHAT_DATA_DIR:data,NEURAL_CHAT_DB_PATH:path.join(data,'test.sqlite3')},windowsHide:true,stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',c=>logs+=c);child.stderr.on('data',c=>logs+=c);
let cookie='';
async function api(route,method='GET',body){return fetch(root+route,{method,headers:{'Content-Type':'application/json',cookie},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});}
async function json(route,method,body){const r=await api(route,method,body);const v=await r.json();assert.ok(r.ok,JSON.stringify(v));return v;}
const stamp=new Date().toISOString();
const msg=(id,role,content)=>({id,role,content,createdAt:stamp});
const make=(id,messages)=>({id,title:'Initial',modelId:'alias',activeBranchId:id,createdAt:stamp,updatedAt:stamp,branches:[{id,name:'Main',messages,createdAt:stamp,updatedAt:stamp}]});
async function runChat(c,messages){await json('/api/conversations','POST',c);await json('/api/chat','POST',{conversationId:c.id,branchId:c.activeBranchId,assistantMessageId:c.id+'-response',modelId:'alias',messages});const r=await api('/api/chat/'+c.id);const stream=await r.text();const snapshots=stream.split('\n').filter(l=>l.startsWith('data: {')).map(l=>JSON.parse(l.slice(6)));assert.equal(snapshots.at(-1).status,'completed',stream);return json('/api/conversations/'+c.id);}
try{
 for(let i=0;i<100;i++){try{if((await fetch(root+'/api/auth/status')).ok)break;}catch{}await delay(100);}
 const setup=await api('/api/auth/setup','POST',{username:'harness',displayName:'Harness QA',password:'HarnessLocal-20260908'});assert.equal(setup.status,201);cookie=setup.headers.get('set-cookie').split(';')[0];
 let config=await json('/api/config');
 const model={id:'base',sourceModel:'base',name:'Base model',isAlias:false,visible:true,connectionId:'test',reasoningSupported:true,reasoningEfforts:['off','on'],reasoningPresets:[],contextWindowTokens:4000};
 const large={...model,id:'large',sourceModel:'large',name:'Large summary model',contextWindowTokens:12000};
 config.connections=[{id:'test',name:'Mock',driver:'openai',baseUrl:`http://127.0.0.1:${mock.address().port}/v1`,apiKey:'',models:[model,large]}];
 config.models=[model,large,{...model,id:'alias',isAlias:true,name:'Alias'}];config.preferences.language='ko';
 config.harnessSettings={...config.harnessSettings,contextMode:'compacting',compactThreshold:50,compactModelId:'large',titlePrompt:'TITLE'};
 config=await json('/api/config','PUT',config);
 const old=msg('old','user','original searchable elephant '.repeat(400));const answer=msg('answer','assistant','prior answer');const latest=msg('latest','user','continue');
 let c=make('compact',[old,answer,latest]);c.branches.push({id:'other',name:'Other',messages:[msg('branch-only','user','branch-exclusive zebra')],createdAt:stamp,updatedAt:stamp});
 c=await runChat(c,c.branches[0].messages);
 assert.equal(c.branches[0].messages[0].content,old.content);assert.equal(c.branches[0].messages.at(-1).contextTokens,100);
 assert.equal(calls[0].model,'large');assert.equal(calls[0].reasoning_effort,'none');
 assert.ok(calls.at(-1).messages.some(m=>String(m.content).includes('Earlier facts retained')));assert.ok(!JSON.stringify(calls.at(-1).messages).includes('elephant'));
 let found=await json('/api/conversations?q=elephant');assert.equal(found.results[0].id,'compact');
 found=await json('/api/conversations?q=zebra');assert.equal(found.results[0].otherBranch,true);assert.equal(found.results[0].branchId,'other');
 await json('/api/conversations/compact','PATCH',{title:'Manual title'});await json('/api/conversations/compact','PUT',{...c,title:'Stale title'});assert.equal((await json('/api/conversations/compact')).title,'Manual title');
 const continuation=[...c.branches[0].messages,msg('next','user','another prompt')];calls.length=0;
 await runChat({...c,branches:c.branches.map(b=>b.id==='compact'?{...b,messages:continuation}:b)},continuation);
 assert.equal(calls.length,1,'Stored summary should be reused after reload');
 for(const timing of ['before','after']){
  config.harnessSettings={...config.harnessSettings,titleEnabled:true,titleTiming:timing};config=await json('/api/config','PUT',config);calls.length=0;
  const messages=[msg('title-'+timing,'user','hello')];const result=await runChat(make('title-'+timing,messages),messages);
  assert.equal(result.title,'Generated title');assert.equal(calls.length,2);assert.equal(calls[timing==='before'?0:1].stream,false);assert.equal(calls[timing==='before'?0:1].model,'base');
 }
 config.harnessSettings={...config.harnessSettings,contextMode:'rolling',titleEnabled:false};config=await json('/api/config','PUT',config);calls.length=0;
 const rollingMessages=[msg('roll-old','user','rolling oldest '.repeat(1000)),msg('roll-answer','assistant','answer'),msg('roll-new','user','new')];
 await runChat(make('rolling',rollingMessages),rollingMessages);assert.equal(calls.length,1);assert.equal(calls[0].messages.at(-1).content,'new');assert.ok(!JSON.stringify(calls[0]).includes('rolling oldest'));
 const invalid=structuredClone(config);invalid.harnessSettings.compactThreshold=100;assert.equal((await api('/api/config','PUT',invalid)).status,400);
 console.log('PASS: compaction, summary reuse, original history, branch search, rename protection, title timing/base model/off, rolling, validation');
 if(process.env.HARNESS_QA_KEEP==='1'){console.log('QA server: '+root+' user=harness password=HarnessLocal-20260908');await writeFile(path.join(data,'qa-ready.txt'),root);await new Promise(()=>{});}
}catch(e){console.error(logs);throw e;}finally{child.kill();mock.close();}
