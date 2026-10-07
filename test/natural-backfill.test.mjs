import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteStore } from '../src/persistence/sqlite.mjs';
import { NaturalCycleRecorder } from '../src/observability/natural-cycle.mjs';
import { backfillAutomaticRecoveryEvents } from '../src/core/natural-backfill.mjs';
import { THREAD,TURN,NEXT } from './fixtures.mjs';
test('missing automatic evidence is backfilled only from a uniquely paired historical event timestamp',()=>{
 let clock=1000;const store=new SqliteStore(':memory:',{now:()=>clock}),recorder=new NaturalCycleRecorder({store,now:()=>999999});
 try{
  recorder.state.cycles.fixture={id:'fixture',threadId:THREAD,failureTurnId:TURN,nextTurnId:NEXT,receipt:true,receiptReal:true,resumeAt:1001,autoResumedAt:null,syntheticEvidence:false,failureObservedAt:500,dispatches:[]};
  store.event('continuation-accepted',{threadId:THREAD,turnId:NEXT});clock=1005;store.event('auto-resumed',{threadId:THREAD});
  assert.equal(backfillAutomaticRecoveryEvents(recorder,store).restored,1);assert.equal(recorder.state.cycles.fixture.autoResumedAt,1005);
  assert.equal(backfillAutomaticRecoveryEvents(recorder,store).restored,0);
  assert.equal(store.events()[0].details.evidenceTimestamp,1005);
 }finally{store.close();}
});
test('synthetic or ambiguous historical rows never supply production evidence',()=>{
 const store=new SqliteStore(':memory:',{now:()=>1000}),recorder=new NaturalCycleRecorder({store});
 try{const cycle={id:'fixture',threadId:THREAD,failureTurnId:TURN,nextTurnId:NEXT,receipt:true,receiptReal:true,resumeAt:1000,autoResumedAt:null,syntheticEvidence:true,failureObservedAt:500,dispatches:[]};recorder.state.cycles.fixture=cycle;store.event('continuation-accepted',{threadId:THREAD,turnId:NEXT});store.event('auto-resumed',{threadId:THREAD});assert.equal(backfillAutomaticRecoveryEvents(recorder,store).restored,0);cycle.syntheticEvidence=false;recorder.state.cycles.ambiguous={...cycle,id:'ambiguous'};assert.equal(backfillAutomaticRecoveryEvents(recorder,store).restored,0);}finally{store.close();}
});
