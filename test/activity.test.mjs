import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { reduceActivity, projectActivity, INACTIVITY_THRESHOLD_MS } from '../src/observability/activity.mjs';
import { ObservabilityService } from '../src/observability/index.mjs';
import { SqliteStore } from '../src/persistence/sqlite.mjs';
import { ControlCenterCore } from '../src/core/control-center.mjs';
const threadId='11111111-1111-4111-8111-111111111111',turnId='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333';
const T=1790000000000;
const event=(at,type,payload)=>({timestamp:new Date(T+at).toISOString(),type,payload});
const ctx={threadId,turnId,epoch:1,now:T+20000};
const canonical=(at=20000)=>({verified:true,threadId,turnId,status:'inProgress',startedAt:T,observedAt:T+at,runtimeType:'active',runtimeFlags:[]});
const started=()=>reduceActivity(null,event(0,'event_msg',{type:'task_started',turn_id:turnId}),ctx);
const project=(state,at=20000,overrides={})=>projectActivity([{state,complete:true,indexedAt:T+at}],{...canonical(at),...overrides},{now:T+at,indexedAt:T+at});

test('real function/custom calls are pending requests even when request generation status is completed',()=>{
 let state=started();
 for(const [type,id]of [['function_call','a'],['custom_tool_call','b']])state=reduceActivity(state,event(1000,'response_item',{type,call_id:id,status:'completed',name:'SECRET_TOOL',arguments:'SECRET_ARGS',input:'SECRET_INPUT'}),ctx);
 let value=project(state);assert.equal(value.status,'ObservedPendingRequest');assert.equal(value.pendingRequests,2);assert.equal(value.executingTools,0);assert.equal(value.authoritativeToolState,'Unavailable');
 state=reduceActivity(state,event(2000,'response_item',{type:'function_call_output',call_id:'a',output:'SECRET_OUTPUT'}),ctx);
 assert.equal(project(state).pendingRequests,1);
 state=reduceActivity(state,event(3000,'response_item',{type:'custom_tool_call_output',call_id:'b',output:'SECRET_OUTPUT'}),ctx);
 assert.equal(project(state).status,'NoObservedPendingTool');assert.equal(project(state).pendingRequests,0);
 assert.doesNotMatch(JSON.stringify(state),/SECRET_|"call_id"|"name"|"arguments"|"output"|"input"/);
});
test('only explicit begin/end support observed execution and malformed envelopes cannot create it',()=>{
 let state=reduceActivity(started(),event(1000,'unknown-envelope',{type:'tool_call_begin',call_id:'fake'}),ctx);assert.equal(Object.keys(state.calls).length,0);
 state=reduceActivity(state,event(2000,'event_msg',{type:'tool_call_begin',call_id:'actual'}),ctx);assert.equal(project(state).status,'ObservedExecuting');
 state=reduceActivity(state,event(3000,'event_msg',{type:'tool_call_end',call_id:'actual'}),ctx);assert.equal(project(state).executingTools,0);
});
test('out-of-order outputs, duplicate begins and terminal tombstones never resurrect a current tool',()=>{
 let state=reduceActivity(started(),event(3000,'response_item',{type:'function_call_output',call_id:'a'}),ctx);
 state=reduceActivity(state,event(1000,'response_item',{type:'function_call',call_id:'a'}),ctx);assert.equal(Object.keys(state.calls).length,0);
 state=reduceActivity(state,event(4000,'event_msg',{type:'tool_call_begin',call_id:'b'}),ctx);
 state=reduceActivity(state,event(5000,'event_msg',{type:'task_complete'}),ctx);
 state=reduceActivity(state,event(6000,'event_msg',{type:'tool_call_begin',call_id:'c'}),ctx);assert.equal(Object.keys(state.calls).length,0);assert.equal(project(state).reason,'observed-turn-terminal');
 for(const status of ['completed','failed','interrupted'])assert.equal(project(started(),20000,{status}).reason,'canonical-turn-not-active');
});
test('exact identity, canonical freshness, complete coverage and event clock are required',()=>{
 const state=reduceActivity(started(),event(1000,'response_item',{type:'function_call',call_id:'a'}),ctx);
 assert.equal(project(state,20000,{turnId:other}).status,'Unavailable');
 assert.equal(project(state,20000,{verified:false}).status,'Unavailable');
 assert.equal(projectActivity([{state,complete:false,indexedAt:T+20000}],canonical(),{now:T+20000,indexedAt:T+20000}).reason,'event-coverage-incomplete');
 assert.equal(projectActivity([{state,complete:true,indexedAt:T+60000}],canonical(),{now:T+60000,indexedAt:T+60000}).reason,'canonical-observation-stale');
 const future=reduceActivity(state,event(50000,'response_item',{type:'function_call',call_id:'future'}),ctx);assert.equal(project(future).status,'Unavailable');
});
test('fifteen-minute silence is a heuristic only; stale tools and user-wait flags are not asserted as current execution',()=>{
 const state=reduceActivity(started(),event(1000,'response_item',{type:'function_call',call_id:'a'}),ctx);
 const value=project(state,INACTIVITY_THRESHOLD_MS+2000);assert.equal(value.status,'Stale');assert.equal(value.pendingRequests,null);assert.equal(value.heuristic.status,'HeuristicSuspectedInactivity');assert.equal(value.heuristic.automaticAction,false);
 const wait=project(state,INACTIVITY_THRESHOLD_MS+2000,{runtimeFlags:['waitingOnApproval']});assert.equal(wait.heuristic.status,'Unavailable');
 const stale=projectActivity([{state,complete:true,indexedAt:T}],canonical(INACTIVITY_THRESHOLD_MS+2000),{now:T+INACTIVITY_THRESHOLD_MS+2000,indexedAt:T});assert.equal(stale.heuristic.status,'Unavailable');
});
test('global index activity cannot refresh a missing, future or stale exact-turn source lease',()=>{
 const state=reduceActivity(started(),event(1000,'response_item',{type:'function_call',call_id:'a'}),ctx);
 const at=INACTIVITY_THRESHOLD_MS+2000;
 for(const indexedAt of [undefined,T,T+at+2000]){
  const value=projectActivity([{state,complete:true,indexedAt}],canonical(at),{now:T+at,indexedAt:T+at});
  assert.equal(value.reason,'event-source-stale-or-detached');assert.equal(value.pendingRequests,null);assert.equal(value.executingTools,null);assert.equal(value.heuristic.status,'Unavailable');
 }
});
test('call and closed tombstone storage are bounded and an epoch reset discards old calls',()=>{
 let state=started();for(let i=0;i<200;i++){state=reduceActivity(state,event(i+1,'response_item',{type:'function_call_output',call_id:String(i)}),ctx);}assert.ok(Object.keys(state.closed).length<=128);
 state=reduceActivity(state,event(1,'response_item',{type:'function_call',call_id:'0'}),ctx);assert.equal(Object.keys(state.calls).length,0);
 const reset=reduceActivity(state,event(1000,'event_msg',{type:'task_started',turn_id:turnId}),{...ctx,epoch:2});assert.equal(reset.epoch,2);assert.equal(Object.keys(reset.closed).length,0);
});
function fixture(t){const home=fs.mkdtempSync(path.join(os.tmpdir(),'activity-'));fs.mkdirSync(path.join(home,'sessions'));const file=path.join(home,'sessions','fixture.jsonl');const store=new SqliteStore(path.join(home,'db.sqlite'));let now=T+10000;const service=new ObservabilityService({store,codexHome:home,now:()=>now});t.after(()=>{store.close();fs.rmSync(home,{recursive:true,force:true});});const line=(at,type,payload)=>JSON.stringify(event(at,type,payload))+'\n';fs.writeFileSync(file,line(0,'session_meta',{id:threadId})+line(0,'event_msg',{type:'task_started',turn_id:turnId})+line(1,'turn_context',{turn_id:turnId}));return{home,file,store,service,line,time:value=>now=T+value};}
test('incremental real log shapes retain event time independently of polls and hide contents from storage/exports',t=>{
 const f=fixture(t);fs.appendFileSync(f.file,f.line(1000,'response_item',{type:'custom_tool_call',call_id:'private-call',name:'PRIVATE_TOOL',input:'PRIVATE_INPUT',arguments:'PRIVATE_ARGS'}));f.service.poll();let v=f.service.currentActivity(canonical(10000));assert.equal(v.status,'ObservedPendingRequest');assert.equal(v.lastEventAt,T+1000);
 f.time(20000);f.service.poll();v=f.service.currentActivity(canonical(20000));assert.equal(v.lastEventAt,T+1000);
 fs.appendFileSync(f.file,f.line(21000,'response_item',{type:'custom_tool_call_output',call_id:'private-call',output:'PRIVATE_OUTPUT'}));f.time(22000);f.service.poll();assert.equal(f.service.currentActivity(canonical(22000)).pendingRequests,0);
 assert.doesNotMatch(JSON.stringify(f.store.db.prepare('SELECT * FROM settings').all()),/PRIVATE_TOOL|PRIVATE_INPUT|PRIVATE_ARGS|PRIVATE_OUTPUT|private-call/);
 assert.doesNotMatch(JSON.stringify(f.service.exportDiagnostics()),/PRIVATE_TOOL|PRIVATE_INPUT|PRIVATE_ARGS|PRIVATE_OUTPUT|private-call/);
});
test('partial tails, truncation and legacy cursors fail closed until a complete new lifecycle is observed',t=>{
 const f=fixture(t);fs.appendFileSync(f.file,f.line(1000,'response_item',{type:'function_call',call_id:'a'})+'{"incomplete":');f.service.poll();assert.equal(f.service.currentActivity(canonical(10000)).status,'Unavailable');
 fs.writeFileSync(f.file,f.line(2000,'session_meta',{id:threadId})+f.line(2001,'turn_context',{turn_id:turnId}));f.service.poll();assert.equal(f.service.currentActivity(canonical(10000)).status,'Unavailable');
 fs.appendFileSync(f.file,f.line(3000,'event_msg',{type:'task_started',turn_id:other})+f.line(3001,'turn_context',{turn_id:other})+f.line(4000,'response_item',{type:'function_call',call_id:'new'}));f.service.poll();assert.equal(f.service.currentActivity({...canonical(10000),turnId:other,startedAt:T+3000}).status,'ObservedPendingRequest');
});
test('a pre-upgrade cursor does not fabricate missing lifecycle coverage or replay the log',t=>{
 const f=fixture(t);f.service.poll();const row=f.store.db.prepare("SELECT key,value FROM settings WHERE key LIKE 'observability:cursor:%'").get();const cursor=JSON.parse(row.value);delete cursor.activity;f.store.setSetting(row.key,cursor);
 f.service.poll();assert.equal(f.service.currentActivity(canonical(10000)).status,'Unavailable');
 fs.appendFileSync(f.file,f.line(2000,'response_item',{type:'function_call',call_id:'legacy-new-request'}));f.service.poll();assert.equal(f.service.currentActivity(canonical(10000)).status,'Unavailable');
 const persisted=f.store.getSetting(row.key);assert.ok(persisted.offset>=cursor.offset);assert.equal(persisted.activity.gap,true);
});
test('a deleted exact-turn log is not kept pending by another thread polling successfully',t=>{
 const f=fixture(t);fs.appendFileSync(f.file,f.line(1000,'response_item',{type:'function_call',call_id:'detached'}));f.service.poll();assert.equal(f.service.currentActivity(canonical(10000)).status,'ObservedPendingRequest');
 fs.unlinkSync(f.file);const another=path.join(f.home,'sessions','other.jsonl');fs.writeFileSync(another,f.line(2000,'session_meta',{id:other})+f.line(2000,'event_msg',{type:'task_started',turn_id:turnId})+f.line(2001,'turn_context',{turn_id:turnId}));
 const at=INACTIVITY_THRESHOLD_MS+2000;f.time(at);f.service.poll();const value=f.service.currentActivity(canonical(at));assert.equal(value.reason,'event-source-stale-or-detached');assert.equal(value.pendingRequests,null);assert.equal(value.heuristic.status,'Unavailable');
 assert.equal(f.store.getSetting('observability:last-poll').timestamp,T+at);
});
test('Core activity replies are nonblocking, sequence/turn guarded and never alter phase, policy or Goal',async()=>{
 let now=T+20000;const record={threadId,currentTurnId:turnId,currentTurnStatus:'inProgress',turnStartedAt:T,lastActivityAt:now,runtimeType:'active',runtimeFlags:[],phase:'watching',reason:'running',currentGoal:{status:'active',tokensUsed:123},policy:{autoResume:true}};
 const resolvers=[];const core=Object.create(ControlCenterCore.prototype);core.now=()=>now;core.engine={state:{records:{[threadId]:record}}};core.observability={call:()=>new Promise(resolve=>resolvers.push(resolve))};const original=structuredClone(record);
 const first=core.observeActivity(record,{canonical:true});await Promise.resolve();const second=core.observeActivity(record,{canonical:true});await Promise.resolve();
 const result={source:'local-session-log',status:'ObservedPendingRequest',lastEventAt:T+1000,pendingRequests:1,executingTools:0,indexedAt:now,heuristic:{status:'NoObservedInactivity',automaticAction:false}};
 resolvers[1](result);await second;resolvers[0]({...result,pendingRequests:9});await first;assert.equal(record.activity.pendingRequests,1);assert.equal(core.activityForSnapshot(record).status,'ObservedPendingRequest');
 assert.deepEqual({...record,activity:undefined},{...original,activity:undefined});
 now+=40000;assert.equal(core.activityForSnapshot(record).status,'Unavailable');record.currentTurnStatus='completed';assert.equal(core.activityForSnapshot(record).reason,'canonical-turn-not-active');
 record.currentTurnId=other;assert.equal(core.activityForSnapshot(record).status,'Unavailable');
});
