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
  const groups=restart.summary({groupBy:'thread'}).groups;assert.equal(groups[0].tokens.input_tokens,200);assert.equal(groups[0].tokens.output_tokens,40);assert.equal(groups[0].tokens.reasoning_output_tokens,5);
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
