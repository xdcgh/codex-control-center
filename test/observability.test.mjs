import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteStore } from '../src/persistence/sqlite.mjs';
import { ObservabilityService, PricingPolicy, validatePricing, unionDuration, normalizeServiceTier } from '../src/observability/index.mjs';
const time='2026-10-07T12:00:00Z';
const usage=(input=100,output=20)=>({input_tokens:input,cached_input_tokens:10,cache_write_input_tokens:0,output_tokens:output,reasoning_output_tokens:5,total_tokens:input+output});
const event=(type,payload)=>JSON.stringify({timestamp:time,type,payload})+'\n';
function fixture(t) {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'observability-'));fs.mkdirSync(path.join(home,'sessions'));
  const store=new SqliteStore(path.join(home,'test.db'));t.after(()=>{store.close();fs.rmSync(home,{recursive:true,force:true});});
  const service=new ObservabilityService({store,codexHome:home});const file=path.join(home,'sessions','test.jsonl');
  fs.writeFileSync(file,event('session_meta',{id:'thread-1',cwd:'C:\\Users\\private\\secret-project',model_provider:'openai'})+event('turn_context',{turn_id:'turn-1',model:'gpt-6.1-sol',service_tier:'standard',effort:'high'}));
  return {home,store,service,file};
}
test('incremental tails, restart, archive duplicate, reset, privacy',t=>{
  const {home,store,service,file}=fixture(t);
  const row=event('event_msg',{type:'token_count',info:{total_token_usage:usage(),last_token_usage:usage(),model_context_window:870000}});
  fs.appendFileSync(file,row.slice(0,-2));assert.equal(service.poll().usage,0);
  fs.appendFileSync(file,row.slice(-2));assert.equal(service.poll().usage,1);assert.equal(service.poll().usage,0);
  const restart=new ObservabilityService({store,codexHome:home});assert.equal(restart.poll().usage,0);
  fs.mkdirSync(path.join(home,'archived_sessions'));fs.copyFileSync(file,path.join(home,'archived_sessions','copy.jsonl'));assert.equal(restart.poll().usage,0);
  fs.appendFileSync(file,event('event_msg',{type:'token_count',info:{total_token_usage:usage(200,40),last_token_usage:usage()}}));assert.equal(restart.poll().usage,1);
  const groups=restart.summary({groupBy:'thread'}).groups,delta=groups.find(g=>g.ledger==='cumulative-delta'),baseline=groups.find(g=>g.ledger==='baseline-counter-inventory');assert.equal(delta.tokens.input_tokens,100);assert.equal(delta.tokens.output_tokens,20);assert.equal(delta.tokens.reasoning_output_tokens,0);assert.equal(baseline.tokens.input_tokens,null);assert.equal(baseline.additiveWithinLedger,false);
  fs.appendFileSync(file,event('event_msg',{type:'token_count',info:{total_token_usage:usage(50,10),last_token_usage:usage(50,10)}}));assert.equal(restart.poll().discontinuities,1);
  fs.appendFileSync(file,event('response_item',{type:'message',content:'PROMPT-SECRET'})+event('response_item',{type:'function_call',arguments:'AUTH-SECRET'}));restart.poll();
  assert.ok(!JSON.stringify(restart.exportDiagnostics()).includes('private'));
  assert.ok(!JSON.stringify(store.db.prepare('SELECT * FROM settings').all()).includes('AUTH-SECRET'));
  assert.ok(!JSON.stringify(restart.rows('token_usage')).includes('PROMPT-SECRET'));
});
test('replacement and truncation replay dedupe',t=>{
  const {service,file}=fixture(t);const head=fs.readFileSync(file,'utf8');const row=event('event_msg',{type:'token_count',info:{total_token_usage:usage()}});
  fs.appendFileSync(file,row);service.poll();fs.writeFileSync(file,head);assert.equal(service.poll().discontinuities,1);fs.appendFileSync(file,row);assert.equal(service.poll().usage,0);
});
test('pricing exact categories, whole long request, tier, partial and historical gaps',t=>{
  const {service}=fixture(t);const p=service.pricing;const e={timestamp:Date.parse(time),provider:'openai',model:'gpt-6.1-sol',serviceTier:'standard',scope:'response',usage:usage()};
  assert.equal(p.estimate(e).usd,(90*2+10*.1+20*10)/1e6);
  const long={...e,usage:usage(272001)};assert.equal(p.estimate(long).context,'long');assert.equal(p.estimate(long).usd,((272001-10)*4+10*.2+20*15)/1e6);
  assert.equal(p.estimate({...e,serviceTier:'fast'}).usd,p.estimate(e).usd*2);
  assert.equal(p.estimate({...e,model:'future-model'}).status,'Unavailable');assert.equal(p.estimate({...e,provider:null}).reason,'provider-missing');
  assert.equal(p.estimate({...e,timestamp:0}).reason,'historical-price-not-established');assert.equal(p.estimate({...e,scope:'cumulative-delta'}).reason,'individual-request-input-unavailable');
  assert.equal(p.estimate({...e,usage:{...e.usage,cache_write_input_tokens:null}}).status,'Partial');
  assert.equal(p.estimate({...e,usage:{...e.usage,cached_input_tokens:101}}).reason,'inconsistent-token-categories');
  assert.equal(p.estimate({...e,usage:{...e.usage,reasoning_output_tokens:21}}).status,'Unavailable');
  const policy=structuredClone(p.policy);policy.id='manual-v2';policy.rows[0].short.input=3;
  assert.throws(()=>p.manualOverride(policy),/confirmation/);p.manualOverride(policy,{confirmed:true});assert.equal(p.snapshots().length,2);
  assert.throws(()=>validatePricing({...policy,rows:[...policy.rows,policy.rows[0]]}),/row/);
});
test('official checker digest and manual gating',async t=>{
  const {service}=fixture(t);const p=service.pricing;let text='official rates';const fetchImpl=async()=>({ok:true,text:async()=>text});
  assert.equal((await p.checkOfficialUpdate({fetchImpl})).baseline,true);assert.equal((await p.checkOfficialUpdate({fetchImpl})).changed,false);text='new official rates';const result=await p.checkOfficialUpdate({fetchImpl});assert.equal(result.changed,true);assert.equal(result.pricesModified,false);
  await assert.rejects(p.checkOfficialUpdate({source:'https://evil.invalid/prices',fetchImpl}),/official/);
});
test('performance uses visible events and overlap-safe tools',t=>{
  const {service,file}=fixture(t);
  const at=(timestamp,type,payload={})=>JSON.stringify({timestamp,type:'event_msg',payload:{type,...payload}})+'\n';
  fs.appendFileSync(file,at('2026-10-07T12:00:00Z','task_started')+at('2026-10-07T12:00:01Z','tool_call_begin',{call_id:'a'})+at('2026-10-07T12:00:02Z','tool_call_begin',{call_id:'b'})+at('2026-10-07T12:00:03Z','agent_message',{message:'SECRET'})+at('2026-10-07T12:00:04Z','tool_call_end',{call_id:'a'})+at('2026-10-07T12:00:05Z','tool_call_end',{call_id:'b'})+at('2026-10-07T12:00:10Z','task_complete'));
  service.poll();const perf=service.performanceSummary();assert.equal(perf.metrics.wall.p50,10000);assert.equal(perf.metrics.firstVisible.p50,3000);assert.equal(perf.metrics.tool.p50,4000);assert.equal(perf.ttft.status,'Unavailable');assert.equal(unionDuration([[0,3],[1,5],[6,8]]),7);
});
test('dynamic grouping never treats capacity as actual request input',t=>{
  const {service,file}=fixture(t);fs.appendFileSync(file,event('event_msg',{type:'token_count',info:{total_token_usage:usage(),model_context_window:870000}}));service.poll();
  for(const groupBy of ['model','tier','effort','turn','thread','goal','workspace','hour','day','5h','week']) assert.equal(service.summary({groupBy}).groups.length,1);
  assert.equal(service.summary().groups[0].inputSamples,0);assert.equal(service.summary().groups[0].pricingStatus,'Unavailable');
  assert.equal(service.quotaCorrelation().confidence,'low');
});
test('last-only repeated snapshots are not an additive request ledger',t=>{
  const {service,file}=fixture(t);
  fs.appendFileSync(file,event('event_msg',{type:'token_count',info:{last_token_usage:usage()}})+JSON.stringify({timestamp:'2026-10-07T12:00:01Z',type:'event_msg',payload:{type:'token_count',info:{last_token_usage:usage()}}})+'\n');
  assert.equal(service.poll().usage,2);
  const g=service.summary().groups[0];assert.equal(g.countLabel,'Usage samples');assert.equal(g.tokens.total_tokens,null);assert.equal(g.estimatedUsd,null);assert.equal(g.pricingStatus,'Unavailable');
});
test('identical usage on distinct response IDs stays distinct; replay stays deduped',t=>{
  const {service,file,store}=fixture(t);
  const a=event('event_msg',{type:'token_usage_record',response_id:'response-a',usage:usage()}),b=event('event_msg',{type:'token_usage_record',response_id:'response-b',usage:usage()});
  fs.appendFileSync(file,a+b+a);assert.equal(service.poll().usage,2);assert.equal(store.db.prepare('SELECT count(*) n FROM model_calls').get().n,2);
  const g=service.summary().groups[0];assert.equal(g.tokens.total_tokens,240);assert.equal(g.countLabel,'Response records');assert.equal(g.pricingStatus,'Estimated');
});
test('quota correlation is empirical, excludes initial baseline, and needs aligned observations',t=>{
  const {service,file,store}=fixture(t);let total=1000;
  for(let i=0;i<4;i++) {
    if(i) total+=i*10;
    const timestamp=`2026-10-07T${12+i}:00:00Z`;
    fs.appendFileSync(file,JSON.stringify({timestamp,type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:total,output_tokens:0,total_tokens:total,cached_input_tokens:0,cache_write_input_tokens:0,reasoning_output_tokens:0}}}})+'\n');
    store.sampleQuota({rateLimits:{primary:{usedPercent:10,windowDurationMins:300}}},Date.parse(timestamp),'fixture');
    store.sampleQuota({rateLimits:{primary:{usedPercent:10+i,windowDurationMins:300}}},Date.parse(timestamp)+1000,'fixture');
  }
  service.poll();const result=service.quotaCorrelation();assert.equal(result.confidence,'low');assert.equal(result.buckets[0].tokenTotal,null);assert.equal(result.correlations[0].samples,3);assert.equal(result.correlations[0].pearson,1);assert.ok(result.label.includes('no official'));
});
test('actual top-level usage record envelope and missing cache counts remain truthful',t=>{
  const {service,file}=fixture(t);const u={...usage(),cache_write_input_tokens:undefined};
  fs.appendFileSync(file,event('token_usage_record',{thread_id:'thread-1',turn_id:'turn-1',response_id:'actual-envelope',root_turn_id:'root-id',session_id:'session-id',usage:u,turn_token_usage:u,thread_token_usage:u}));service.poll();
  const g=service.summary().groups[0];assert.equal(g.ledger,'response');assert.equal(g.tokens.input_tokens,100);assert.equal(g.tokens.cache_write_input_tokens,null);assert.equal(g.missing.cache_write_input_tokens,1);assert.equal(g.pricingStatus,'Partial');assert.equal(g.estimatedUsd,null);
});
test('explicit OpenAI default normalizes to Standard while unknown or auto stays unknown',t=>{
  const {service}=fixture(t);assert.equal(normalizeServiceTier('default','openai'),'standard');assert.equal(normalizeServiceTier('default','other'),'default');assert.equal(normalizeServiceTier('auto','openai'),'auto');assert.equal(normalizeServiceTier(null,'openai'),null);
  const e={timestamp:Date.parse(time),provider:'openai',model:'gpt-6.1-sol',rawServiceTier:'default',serviceTier:'default',scope:'response',usage:usage()};assert.equal(service.pricing.estimate(e).status,'Estimated');assert.equal(service.pricing.estimate({...e,rawServiceTier:'auto'}).status,'Unavailable');
});
test('observed turn metadata enriches only matching future events and retains raw tier',t=>{
  const {service,file}=fixture(t);let head=fs.readFileSync(file,'utf8');head=head.replace('"service_tier":"standard",','');fs.writeFileSync(file,head);
  service.observeTurnMetadata({threadId:'thread-1',turnId:'turn-1',rawServiceTier:'default',provider:'openai',observedAt:Date.parse(time)+1000,source:'desktop-ipc',prompt:'DO-NOT-STORE'});
  fs.appendFileSync(file,event('token_usage_record',{turn_id:'turn-1',response_id:'before',usage:usage()})+JSON.stringify({timestamp:'2026-10-07T12:00:02Z',type:'token_usage_record',payload:{turn_id:'turn-1',response_id:'after',usage:usage()}})+'\n');service.poll();
  const rows=service.rows('token_usage');assert.equal(rows[0].serviceTier,null);assert.equal(rows[1].rawServiceTier,'default');assert.equal(rows[1].serviceTier,'standard');assert.equal(service.pricing.estimate(rows[1]).status,'Partial');assert.equal(service.pricing.estimate(rows[1]).reason,'configured-turn-tier-not-response-confirmed');
  assert.throws(()=>service.observeTurnMetadata({threadId:'thread-1',turnId:'turn-1',source:'guess'}),/invalid/);
});
test('initial, inherited and reset counters are inventory rather than consumption',t=>{
  const {service,file}=fixture(t);
  fs.appendFileSync(file,event('event_msg',{type:'token_count',info:{total_token_usage:usage(1000000,1000)}})+JSON.stringify({timestamp:'2026-10-07T12:00:01Z',type:'event_msg',payload:{type:'token_count',info:{total_token_usage:usage(1000010,1002)}}})+'\n'+JSON.stringify({timestamp:'2026-10-07T12:00:02Z',type:'event_msg',payload:{type:'token_count',info:{total_token_usage:usage(50,10)}}})+'\n');
  const fork=path.join(path.dirname(file),'fork.jsonl');fs.writeFileSync(fork,event('session_meta',{id:'fork-thread',parent_thread_id:'thread-1',forked_from_id:'thread-1',model_provider:'openai'})+event('turn_context',{turn_id:'fork-turn',model:'gpt-6.1-sol'})+event('event_msg',{type:'token_count',info:{total_token_usage:usage(1000000,1000)}}));service.poll();
  const groups=service.summary().groups,inventory=groups.find(g=>g.ledger==='baseline-counter-inventory'),delta=groups.find(g=>g.ledger==='cumulative-delta');assert.equal(inventory.samples,3);assert.equal(inventory.tokens.input_tokens,null);assert.equal(inventory.counterInventoryStats.input_tokens.max,1000000);assert.equal(inventory.estimatedUsd,null);assert.equal(inventory.additiveWithinLedger,false);assert.equal(delta.tokens.input_tokens,10);assert.equal(delta.tokens.output_tokens,2);assert.equal(delta.canCombineWithOtherLedgers,false);
});
test('out-of-order archive observations do not roll back the durable counter baseline',t=>{
  const {service,file}=fixture(t);const row=(timestamp,u)=>JSON.stringify({timestamp,type:'event_msg',payload:{type:'token_count',info:{total_token_usage:u}}})+'\n';
  fs.appendFileSync(file,row('2026-10-07T12:00:01Z',usage(100,20))+row('2026-10-07T12:00:03Z',usage(200,40))+row('2026-10-07T12:00:02Z',usage(150,30))+row('2026-10-07T12:00:04Z',usage(210,42)));service.poll();
  const delta=service.summary().groups.find(g=>g.ledger==='cumulative-delta');assert.equal(delta.tokens.input_tokens,110);assert.equal(delta.tokens.output_tokens,22);assert.equal(service.rows('token_usage').filter(r=>r.outOfOrder).length,1);
});
test('legacy baseline flags classify correctly without clearing or rewriting stored records',t=>{
  const {service,store}=fixture(t);const baseline={threadId:'thread-1',turnId:'turn-1',model:'gpt-6.1-sol',provider:'openai',timestamp:Date.parse(time),scope:'cumulative-delta',initialCounter:true,usage:usage(77738040827,218796327)};store.db.prepare('INSERT INTO token_usage VALUES(?,?,?,?)').run('legacy-baseline','thread-1','turn-1',JSON.stringify(baseline));
  const g=service.summary().groups[0];assert.equal(g.ledger,'baseline-counter-inventory');assert.equal(g.tokens.total_tokens,null);assert.equal(g.pricingStatus,'Unavailable');assert.equal(service.rows('token_usage')[0].scope,'cumulative-delta');
});
test('response IDs shared by root and fork scopes are counted once within a known provider',t=>{
  const {service,store}=fixture(t);for(const [id,threadId] of [['a','thread-a'],['b','thread-b']]){const r={threadId,turnId:'turn-id',responseId:'shared-response',provider:'openai',model:'gpt-6.1-sol',scope:'response',timestamp:Date.parse(time),usage:usage()};store.db.prepare('INSERT INTO token_usage VALUES(?,?,?,?)').run(id,threadId,'turn-id',JSON.stringify(r));}const s=service.summary();assert.equal(s.duplicateResponseRecords,1);assert.equal(s.groups[0].tokens.input_tokens,100);assert.equal(s.groups[0].samples,1);
});
test('a newly exposed cache field cannot be treated as an additive delta from an unknown baseline',t=>{
  const {service,file}=fixture(t);const missing={...usage(100,20),cache_write_input_tokens:undefined};fs.appendFileSync(file,event('event_msg',{type:'token_count',info:{total_token_usage:missing}})+JSON.stringify({timestamp:'2026-10-07T12:00:01Z',type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{...usage(110,22),cache_write_input_tokens:5}}}})+'\n');service.poll();const d=service.summary().groups.find(g=>g.ledger==='cumulative-delta');assert.equal(d.tokens.input_tokens,10);assert.equal(d.tokens.cache_write_input_tokens,null);assert.equal(d.missing.cache_write_input_tokens,1);
});
test('context capacity and collaboration metadata persist without becoming request length or retaining instructions',t=>{
  const {service,file}=fixture(t);fs.appendFileSync(file,event('turn_context',{turn_id:'turn-1',model:'gpt-6.1-sol',service_tier:'default',effort:'high',root_turn_id:'root-private',collaboration_mode:{mode:'default',settings:{developer_instructions:'PRIVATE-INSTRUCTIONS'}}})+event('event_msg',{type:'token_count',info:{total_token_usage:usage(),last_token_usage:usage(),model_context_window:870000}}));service.poll();const r=service.rows('token_usage')[0];assert.equal(r.modelContextWindow,870000);assert.equal(r.collaborationMode,'default');assert.equal(r.rootTurnId,'root-private');assert.ok(!JSON.stringify(r).includes('PRIVATE-INSTRUCTIONS'));assert.equal(service.summary().groups[0].configuredContextWindowStatistics.mean,870000);assert.equal(service.summary().groups[0].longContextRequests,null);
});
test('request and turn distributions stay within a deduped response ledger with explicit context and tier coverage',t=>{
  const {service,file}=fixture(t);fs.appendFileSync(file,event('token_usage_record',{response_id:'r1',turn_id:'turn-1',usage:usage(100,20)})+event('token_usage_record',{response_id:'r2',turn_id:'turn-1',usage:usage(300000,40)})+event('turn_context',{turn_id:'turn-2',model:'gpt-6.1-sol',service_tier:'priority',collaboration_mode:{mode:'plan'}})+event('token_usage_record',{response_id:'r3',turn_id:'turn-2',usage:usage(200,30)}));service.poll();const g=service.summary().groups.find(g=>g.ledger==='response');assert.equal(g.requestCount,3);assert.equal(g.observedTurns,2);assert.equal(g.turnTokenStatistics.mean,(300160+230)/2);assert.equal(g.turnTokenStatistics.p50,230);assert.equal(g.turnTokenStatistics.p95,300160);assert.equal(g.averageRequestInput,(100+300000+200)/3);assert.equal(g.longContextRequests,1);assert.deepEqual(g.tierRequestCounts,{fast:1,standard:2,other:0,unknown:0});assert.equal(g.collaborationModeCounts.plan,1);assert.equal(service.summary({groupBy:'collaboration'}).groups.length,2);
});
test('an unknown provider cannot turn response record coverage into a precise request count',t=>{
  const {service,file}=fixture(t);fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace(',"model_provider":"openai"',''));fs.appendFileSync(file,event('token_usage_record',{response_id:'unknown-provider-response',usage:usage()}));service.poll();const g=service.summary().groups[0];assert.equal(g.requestCount,null);assert.equal(g.knownProviderRequestRecords,0);assert.equal(g.pricingStatus,'Unavailable');
});
test('performance distributions group by actual provider/model/tier and never add overlapping response and counter output',t=>{
  const {service,store}=fixture(t);const a={threadId:'thread-1',turnId:'a',timestamp:Date.parse(time),provider:'openai',model:'gpt-6.1-sol',rawServiceTier:'default',start:0,end:10000,wallMs:10000,firstVisibleMs:2000,toolIntervals:[[1000,4000],[2000,5000]],toolsObserved:true,missingToolEnds:0};const b={...a,turnId:'b',rawServiceTier:'priority',wallMs:5000,end:5000,firstVisibleMs:null,toolsObserved:false};for(const [id,s] of [['a',a],['b',b]])store.db.prepare('INSERT INTO performance_samples VALUES(?,?)').run(id,JSON.stringify(s));
  for(const [id,scope,turnId,u] of [['response','response','a',usage(100,100)],['delta','cumulative-delta','a',usage(100,100)],['response-b','response','b',usage(100,50)]])store.db.prepare('INSERT INTO token_usage VALUES(?,?,?,?)').run(id,'thread-1',turnId,JSON.stringify({threadId:'thread-1',turnId,provider:'openai',responseId:scope==='response'?id:null,scope,timestamp:Date.parse(time),usage:u}));
  const p=service.performanceSummary();assert.equal(p.groups.length,2);assert.equal(p.metrics.wall.mean,7500);assert.equal(p.metrics.effectiveThroughput.mean,10);const standard=p.groups.find(g=>g.serviceTier==='standard'),fast=p.groups.find(g=>g.serviceTier==='fast');assert.equal(standard.rawServiceTiers.default,1);assert.equal(standard.metrics.tool.mean,4000);assert.equal(fast.metrics.firstVisible.samples,0);assert.equal(fast.metrics.firstVisible.missing,1);for(const g of p.groups){assert.equal(g.ttft.status,'Unavailable');assert.equal(g.decode.status,'Unavailable');assert.equal(g.modelWaiting.status,'Unavailable');}
});
test('pricing validation rejects malformed effective dates and non-USD/non-MTok units while allowing dynamic tier rows',t=>{
  const {service}=fixture(t);const policy=structuredClone(service.pricing.policy);assert.throws(()=>validatePricing({...policy,effectiveFrom:'not-a-date'}),/schema/);assert.throws(()=>validatePricing({...policy,currency:'EUR'}),/schema/);assert.throws(()=>validatePricing({...policy,unit:'per-token'}),/schema/);policy.id='dynamic-tier';policy.rows[0].tier='future-official-tier';assert.equal(validatePricing(policy).rows[0].tier,'future-official-tier');assert.equal(service.pricing.estimate({timestamp:Date.parse(time),provider:'openai',model:'gpt-6.1-sol',serviceTier:'standard',scope:'response',usage:usage(),region:'eu'}).reason,'regional-adjustment-not-established');
});
test('official checker returns safe HTTP failure and bounded timeout without recording a digest or modifying prices',async t=>{
  const {service,store}=fixture(t);const snapshot=JSON.stringify(service.pricingSnapshots());const response=await service.pricing.checkOfficialUpdate({fetchImpl:async()=>({ok:false,status:403}),timeoutMs:100});assert.equal(response.status,'Unavailable');assert.equal(response.httpStatus,403);assert.equal(response.reason,'official-source-http-error');assert.equal(response.pricesModified,false);assert.equal(store.getSetting('observability:pricing-source:'+response.source),null);
  const stalled=await service.pricing.checkOfficialUpdate({fetchImpl:async()=>new Promise(()=>{}),timeoutMs:5});assert.equal(stalled.reason,'official-source-timeout');assert.equal(JSON.stringify(service.pricingSnapshots()),snapshot);await assert.rejects(service.pricing.checkOfficialUpdate({source:'https://user:secret@developers.openai.com/api/docs/pricing.md'}),/official/);
});
