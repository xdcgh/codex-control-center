import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteStore } from '../src/persistence/sqlite.mjs';
import { ControlCenterCore } from '../src/core/control-center.mjs';
import { migrateLegacy } from '../src/core/migration.mjs';
import { assertOwnerHandover } from '../src/adapters/codex.mjs';
import { NaturalCycleRecorder } from '../src/observability/natural-cycle.mjs';
import { task,limits,NOW,THREAD,NEXT } from './fixtures.mjs';

function rig({ execute=true, goal=false, settings={},natural=false }={}) {
  let now=NOW, quota=limits(), state=task({ status:'inProgress',goalStatus:goal?'active':undefined }), polls=0;
  const writes=[], store=new SqliteStore(':memory:',{now:()=>now});
  const desktop={ snapshot:async()=>({state:structuredClone(state),owner:'fixture'}), request:async(method,params)=>{writes.push(params);return{handledByClientId:'fixture',result:{result:{turn:{id:NEXT}}}}} };
  const account={request:async(method,params)=>{
    if(method==='account/rateLimits/read')return quota;
    if(method==='thread/goal/get')return{goal:structuredClone(state.threadGoal)};
    if(method==='thread/goal/set'){state.threadGoal.status='active';return{goal:structuredClone(state.threadGoal)};}
    throw Error('unexpected-method');
  }};
  const adapter={desktop,account,source:'simulated-test-fixture',compatibility:{verified:true,cliVersion:'fixture'},connect:async()=>{},readQuota:async()=>{polls++;return quota;}, listThreads:()=>[THREAD],isEligible:()=>true,snapshot:desktop.snapshot,unfollow:()=>{},verifyWriteSafety:()=>{},probeCompatibility:()=>{},close:async()=>{} };
  const recorder=natural?new NaturalCycleRecorder({store,now:()=>now}):undefined;
  let core=new ControlCenterCore({adapter,store,recorder,now:()=>now,execute,settings:{autoResume:true,...settings}});
  return{store,adapter,writes,recorder,get core(){return core},get polls(){return polls},time:n=>now=n,quota:q=>quota=q,state:s=>state=s,restart:()=>{core=new ControlCenterCore({adapter,store,recorder,now:()=>now,execute});},async enroll(){await core.tick();state=task({goalStatus:goal?'usageLimited':undefined});now+=10000;await core.tick();},close(){store.close()}};
}

test('live quota recovery fires at the next 10-second check, with independent 60-second history',async()=>{
 const r=rig();try{await r.enroll();assert.equal(r.writes.length,0);r.time(NOW+20000);r.quota(limits({used:0,reset:NOW+999999}));await r.core.tick();assert.equal(r.writes.length,1);assert.equal(r.polls,3);assert.equal(r.store.queryQuotaHistory().length,2);assert.doesNotMatch(r.writes[0].turnStart.request.input[0].text,/2 分钟/);r.time(NOW+60000);await r.core.tick();assert.equal(r.store.queryQuotaHistory().length,4);}finally{r.close();}
});
test('weekly exhaustion, user approval and manual policy pause suppress automatic resume',async()=>{
 for(const kind of ['weekly','approval','pause']){const r=rig();try{await r.enroll();r.time(NOW+20000);r.quota(limits({used:0,weekly:kind==='weekly'?100:10}));if(kind==='approval')r.state(task({requests:[{method:'approval'}]}));if(kind==='pause')r.core.setThreadPolicy(THREAD,{manualPaused:true});await r.core.tick();assert.equal(r.writes.length,0);}finally{r.close();}}
});
test('Goal restoration preserves original goal; lost acknowledgement survives restart without replay',async()=>{
 const r=rig({goal:true});try{await r.enroll();r.time(NOW+20000);r.quota(limits({used:0}));r.adapter.desktop.request=async()=>{r.writes.push('accepted');throw Error('delivery-uncertain');};await r.core.tick();assert.equal(r.writes.length,1);assert.equal(r.core.snapshot().tasks[0].phase,'needsAttention');r.restart();r.time(NOW+30000);await r.core.tick();assert.equal(r.writes.length,1);assert.equal(r.store.load().ledger[`${THREAD}:00000000-0000-4000-8000-000000000002`].phase,'uncertain');}finally{r.close();}
});
test('unknown compatibility allows quota history while disabling dispatch',async()=>{
 const r=rig();try{await r.enroll();r.adapter.compatibility.verified=false;r.time(NOW+60000);r.quota(limits({used:0}));await r.core.tick();assert.equal(r.writes.length,0);assert.equal(r.store.queryQuotaHistory().length,4);}finally{r.close();}
});
test('transient API errors back off; reserve protects low-priority work',async()=>{
 const r=rig();try{await r.enroll();r.time(NOW+20000);r.quota(limits({used:95}));await r.core.tick();assert.equal(r.writes.length,0);r.core.setThreadPolicy(THREAD,{priority:0});r.time(NOW+30000);await r.core.tick();assert.equal(r.writes.length,1);r.adapter.readQuota=async()=>{throw Error('network-failed')};r.time(NOW+40000);await r.core.tick();assert.equal(r.core.nextQuotaPollAt,NOW+60000);await r.core.tick();assert.equal(r.core.errorCount,1);}finally{r.close();}
});
test('SQLite ledger and waiting incident survive reopening the database',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ccc-fixture-'));const file=path.join(directory,'fixture.sqlite');let s;
 try{s=new SqliteStore(file);s.save({schemaVersion:1,startedAt:'fixture',records:{[THREAD]:{threadId:THREAD,phase:'waitingQuota'}},ledger:{incident:{phase:'dispatching',messageId:'fixture'}}});s.setThreadPolicy(THREAD,{manualPaused:true});s.close();s=new SqliteStore(file);assert.equal(s.load().records[THREAD].phase,'waitingQuota');assert.equal(s.load().ledger.incident.phase,'dispatching');assert.equal(s.getThreadPolicy(THREAD).manualPaused,true);}finally{s?.close();fs.rmSync(directory,{recursive:true,force:true});}
});
test('a manual pause arriving during the final quota read prevents the native turn',async()=>{
 const r=rig();try{await r.enroll();r.time(NOW+20000);r.quota(limits({used:0}));const original=r.adapter.account.request;let calls=0;r.adapter.account.request=async(...args)=>{if(args[0]==='account/rateLimits/read'&&++calls===2)r.core.setThreadPolicy(THREAD,{manualPaused:true});return original(...args);};await r.core.tick();assert.equal(r.writes.length,0);}finally{r.close();}
});
test('slow thread scans do not block the independently scheduled quota reader',async()=>{
 const r=rig({execute:false});try{let release;const gate=new Promise(resolve=>release=resolve);r.adapter.snapshot=async()=>{await gate;return{state:task({status:'inProgress'}),owner:'fixture'};};const scan=r.core.tick();await new Promise(resolve=>setImmediate(resolve));assert.equal(r.polls,1);r.time(NOW+10000);await r.core.pollQuota();assert.equal(r.polls,2);assert.equal(r.core.lastQuotaPollAt,NOW+10000);release();await scan;}finally{r.close();}
});
test('legacy migration is dry-run by default and preserves uncertain intents',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ccc-migration-fixture-'));const store=new SqliteStore(':memory:');
 try{const state={schemaVersion:1,startedAt:new Date(NOW).toISOString(),records:{[THREAD]:{threadId:THREAD,phase:'waitingQuota',failureTurnId:NEXT,notBeforeMs:NOW+999999}},ledger:{incident:{phase:'uncertain',messageId:'same-fixture'}}};fs.writeFileSync(path.join(directory,'state.json'),JSON.stringify(state));fs.writeFileSync(path.join(directory,'control.json'),JSON.stringify({enabled:false,stop:true}));assert.equal(migrateLegacy(store,directory).dryRun,true);assert.deepEqual(store.load().ledger,{});migrateLegacy(store,directory,{dryRun:false});assert.equal(store.load().ledger.incident.phase,'uncertain');assert.equal(store.load().records[THREAD].notBeforeMs,0);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory,'state.json'),'utf8')),state);assert.throws(()=>migrateLegacy(store,directory,{dryRun:false}),/destination-must-be-empty/);}finally{store.close();fs.rmSync(directory,{recursive:true,force:true});}
});
test('two-owner execution is rejected until the legacy control is disabled',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ccc-owner-fixture-'));
 try{const config={ownerHandoverAcknowledged:true,stateDirectory:path.join(directory,'new'),legacyStateDirectory:directory};fs.writeFileSync(path.join(directory,'control.json'),JSON.stringify({enabled:true}));assert.throws(()=>assertOwnerHandover(config),/must-be-paused/);fs.writeFileSync(path.join(directory,'control.json'),JSON.stringify({enabled:false}));assert.doesNotThrow(()=>assertOwnerHandover(config));assert.throws(()=>assertOwnerHandover({...config,ownerHandoverAcknowledged:false}),/explicit-owner-handover/);}finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('Core recorder hooks preserve a synthetic cycle with one real mock receipt and never call it natural PASS',async()=>{
 const r=rig({natural:true});try{await r.enroll();r.time(NOW+70000);r.quota(limits({used:0,reset:NOW+18000000}));await r.core.tick();assert.equal(r.writes.length,1);const complete=task({status:'completed'});complete.turnHistory.history.entitiesByKey.tail.turnId=NEXT;r.state(complete);r.time(NOW+80000);await r.core.tick();const report=r.recorder.report();assert.equal(report.json.status,'SIMULATED');assert.equal(report.json.cycles[0].dispatchCount,1);assert.equal(report.json.cycles[0].detectedRecoveryAt,NOW+70000);assert.equal(report.json.cycles[0].resumeAt,NOW+70000);assert.equal(report.json.cycles[0].autoResumedAt,NOW+70000);assert.equal(report.json.cycles[0].nextTurnEndAt,NOW+80000);assert.equal(JSON.stringify(report).includes(THREAD),false);}finally{r.close();}
});
