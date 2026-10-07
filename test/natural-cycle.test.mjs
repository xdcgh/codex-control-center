import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteStore } from '../src/persistence/sqlite.mjs';
import { NaturalCycleRecorder } from '../src/observability/natural-cycle.mjs';
const threadId='thread-private',failure='failure-private',next='next-private',source='synthetic-fixture';
function fixture(t) { const store=new SqliteStore(':memory:');t.after(()=>store.close());return {store,recorder:new NaturalCycleRecorder({store,now:()=>100000})}; }
const snapshot=(status,turnId=failure,goal)=>({id:threadId,latestModel:'gpt-6.1-sol',cwd:'C:\\Users\\secret',title:'SECRET PROMPT',threadGoal:goal,turns:[{turnId,status,error:status==='failed'?{codexErrorInfo:'usageLimitExceeded'}:null}]});
const raw=(p=100,s=100,nextReset=120)=>({rateLimits:{primary:{windowDurationMins:300,usedPercent:p,resetsAt:nextReset},secondary:{windowDurationMins:10080,usedPercent:s,resetsAt:nextReset+10},credits:{balance:'ACCOUNT SECRET'}}});
function begin(recorder,{src=source,goal=false,working=true}={}) {
  if(working) recorder.onThread({threadId,snapshot:snapshot('inProgress',failure,goal?{status:'active',objective:'SECRET GOAL'}:null),decision:{action:'running'},observedAt:100000,source:src});
  recorder.onQuota(raw(),101000,src);
  recorder.onThread({threadId,snapshot:snapshot('failed',failure,goal?{status:'usageLimited',objective:'SECRET GOAL'}:null),decision:{action:'quotaFailure'},record:{phase:'waitingQuota'},observedAt:102000,source:src});
}
function dispatch(recorder,src=source) {
  const intent={failureTurnId:failure,phase:'sent',messageId:'dispatch-one',sentAt:132000,confirmedTurnId:next};
  recorder.onEngineEvent('continuation-accepted',{threadId,turnId:next,intent,observedAt:133000,source:src});
  recorder.onEngineEvent('auto-resumed',{threadId,intent,observedAt:134000,source:src});return intent;
}
test('simulation records original reset and first all-window recovery durably, never natural PASS',t=>{
  const {store,recorder}=fixture(t);begin(recorder);recorder.onQuota(raw(0,100,130),131000,source);
  assert.equal(recorder.report().json.cycles[0].detectedRecoveryAt,null);
  recorder.onQuota(raw(0,0,500),132000,source);const intent=dispatch(recorder);
  recorder.onThread({threadId,snapshot:snapshot('completed',next),intent,observedAt:140000,source});
  const restarted=new NaturalCycleRecorder({store,now:()=>200000});restarted.onQuota(raw(0,0,900),200000,source);
  const c=restarted.report({threadId}).json.cycles[0];assert.equal(c.status,'SIMULATED');assert.equal(c.originalExhaustedResetsAt,130000);assert.equal(c.detectedRecoveryAt,132000);assert.equal(c.detectionLatencyMs,2000);assert.equal(c.resumeLatencyMs,1000);assert.equal(c.resetToResumeLatencyMs,3000);assert.equal(c.dispatchCount,1);assert.equal(c.receipt,'OBSERVED');
});
test('real source without prior working or structured failure remains incomplete; Goal label alone is insufficient',t=>{
  const {recorder}=fixture(t);begin(recorder,{src:'official-app-server',working:false});
  assert.equal(recorder.report().json.cycles[0].status,'INCOMPLETE');
  const other='goal-private';recorder.onThread({threadId:other,snapshot:{...snapshot('completed'),id:other,threadGoal:{status:'usageLimited',objective:'SECRET'}},decision:{action:'quotaFailure'},record:{phase:'waitingQuota'},observedAt:103000,source:'desktop-ipc'});
  const c=recorder.report({threadId:other}).json.cycles[0];assert.equal(c.status,'INCOMPLETE');assert.ok(c.reasons.includes('structured-turn-usage-limit-exceeded-not-observed'));
});
test('unknown quota and later reset do not invent recovery or original exhausted deadline',t=>{
  const {recorder}=fixture(t);recorder.onQuota({known:false,ready:false},100000,'official-app-server');
  recorder.onThread({threadId,snapshot:snapshot('failed'),decision:{action:'quotaFailure'},record:{phase:'waitingQuota'},observedAt:101000,source:'desktop-ipc'});
  recorder.onQuota(raw(0,0,900),200000,'official-app-server');const c=recorder.report().json.cycles[0];assert.equal(c.detectedRecoveryAt,null);assert.equal(c.originalExhaustedResetsAt,null);assert.equal(c.status,'INCOMPLETE');
});
test('uncertain delivery, missing receipt, manual override, duplicate dispatch are explicit evidence',t=>{
  const {recorder}=fixture(t);begin(recorder,{src:'official-app-server'});recorder.onQuota(raw(0,0,500),132000,'official-app-server');
  recorder.onEngineEvent('task-state',{threadId,phase:'needsAttention',intent:{failureTurnId:failure,phase:'uncertain',sentAt:132000,messageId:'one'},observedAt:133000,source:'official-app-server'});
  let c=recorder.report().json.cycles[0];assert.equal(c.status,'UNKNOWN');assert.equal(c.receipt,'UNKNOWN');assert.ok(c.reasons.includes('transport-receipt-missing'));
  recorder.onManualAction({threadId,observedAt:134000});assert.ok(recorder.report().json.cycles[0].reasons.includes('manual-override-observed'));
  recorder.onEngineEvent('continuation-accepted',{threadId,turnId:next,intent:{failureTurnId:failure,phase:'sent',sentAt:135000,messageId:'two',confirmedTurnId:next},observedAt:136000,source:'official-app-server'});
  c=recorder.report().json.cycles[0];assert.equal(c.status,'FAIL');assert.equal(c.dispatchCount,2);assert.equal(c.duplicateDispatch,'OBSERVED');
});
test('missing cycle defaults NOT_OBSERVED; exports omit identifiers, contents, paths and account values',t=>{
  const {recorder,store}=fixture(t);assert.equal(recorder.report().json.status,'NOT_OBSERVED');begin(recorder,{goal:true});
  const report=recorder.report({versions:{cliVersion:'0.127.0',desktopVersion:'26.930.1',account:'ACCOUNT SECRET'},commit:'abc1234',token:'SECRET'}),serialized=JSON.stringify(report);
  for(const secret of [threadId,failure,'SECRET','C:\\Users','objective','balance']) assert.ok(!serialized.includes(secret),secret);
  assert.ok(store.getSetting('natural-cycle:v1').cycles);assert.equal(report.json.commit,'abc1234');
});
test('synthetic Goal needs observed completion; stale or partial window reads never suffice',t=>{
  const {recorder}=fixture(t);begin(recorder,{goal:true});recorder.onQuota({known:true,ready:true,windows:[{durationMinutes:300,usedPercent:0,resetsAt:500000}]},132000,source);assert.equal(recorder.report().json.cycles[0].detectedRecoveryAt,null);
  recorder.onQuota(raw(0,0,500),133000,source);const intent=dispatch(recorder);
  recorder.onThread({threadId,snapshot:snapshot('completed',next,{status:'active',objective:'SECRET GOAL'}),intent,observedAt:140000,source});assert.ok(recorder.report().json.cycles[0].reasons.includes('goal-completion-not-observed'));
  recorder.onThread({threadId,snapshot:snapshot('completed',next,{status:'complete',objective:'SECRET GOAL'}),observedAt:150000,source});assert.equal(recorder.report().json.cycles[0].goalCompletedAt,150000);
});
test('replacement Goal completion cannot prove the original Goal recovered',t=>{
  const {recorder}=fixture(t);begin(recorder,{goal:true,src:'official-app-server'});recorder.onQuota(raw(0,0,500),132000,'official-app-server');const intent=dispatch(recorder,'official-app-server');
  recorder.onThread({threadId,snapshot:snapshot('completed',next,{status:'complete',objective:'OTHER PRIVATE GOAL'}),intent,observedAt:140000,source:'desktop-ipc'});
  const c=recorder.report().json.cycles[0];assert.equal(c.status,'UNKNOWN');assert.equal(c.goalCompletedAt,null);assert.ok(c.reasons.includes('goal-identity-changed'));
});
test('an unknown-source ready reading cannot replace the first real recovery poll',t=>{
  const {recorder}=fixture(t);begin(recorder,{src:'official-app-server'});recorder.onQuota(raw(0,0,500),131000,'unknown');assert.equal(recorder.report().json.cycles[0].detectedRecoveryAt,null);
  recorder.onQuota(raw(0,0,600),132000,'official-app-server');assert.equal(recorder.report().json.cycles[0].detectedRecoveryAt,132000);
});
test('canonical target history links repeated same-Goal quota cycles without unrelated or duplicate attribution',t=>{
  const {recorder}=fixture(t),goal={status:'active',objective:'SECRET GOAL'};begin(recorder,{goal:true});recorder.onQuota(raw(0,0,500),132000,source);dispatch(recorder);
  recorder.onThread({threadId,snapshot:snapshot('inProgress',next,goal),decision:{action:'running'},observedAt:135000,source});
  recorder.onQuota(raw(100,100,160),139000,source);
  recorder.onThread({threadId,snapshot:snapshot('failed',next,{...goal,status:'usageLimited'}),decision:{action:'quotaFailure'},record:{phase:'waitingQuota'},observedAt:140000,source});
  recorder.onQuota(raw(0,0,500),171000,source);const successor='successor-private';const intent={failureTurnId:next,messageId:'second-dispatch',sentAt:172000,phase:'sent',confirmedTurnId:successor};
  recorder.onEngineEvent('continuation-accepted',{threadId,turnId:successor,intent,observedAt:173000,source});recorder.onEngineEvent('auto-resumed',{threadId,intent,observedAt:174000,source});
  const canonical={id:threadId,latestModel:'gpt-6.1-sol',threadGoal:goal,turnHistory:{kind:'canonical',history:{entitiesByKey:{prior:{turnId:next,status:'failed',turnStartedAtMs:132000,error:{codexErrorInfo:'usageLimitExceeded'}},current:{turnId:successor,status:'inProgress',turnStartedAtMs:172000}},islands:[{entries:[{value:'prior'},{value:'current'}],newerBoundary:{status:'exhausted'}}]}}};
  recorder.onThread({threadId,snapshot:canonical,decision:{action:'running'},intent,observedAt:180000,source});const cycles=recorder.report().json.cycles;
  assert.equal(cycles.length,2);assert.equal(cycles[0].episode.outcome,'CONTINUED_THEN_QUOTA_LIMITED');assert.equal(cycles[0].successorCycleFingerprint,cycles[1].cycleFingerprint);assert.equal(cycles[0].nextTurnEndAt,140000);assert.equal(cycles[0].autoResumedAt,134000);assert.equal(cycles[1].episode.outcome,'CONTINUING');
  for(const c of cycles){assert.equal(c.dispatchCount,1);assert.equal(c.status,'SIMULATED');assert.equal(c.goalOutcome,'PENDING');assert.ok(!c.reasons.includes('unrelated-next-turn-observed'));assert.ok(!c.reasons.includes('duplicate-dispatch-observed'));}
});
test('a later tail with absent target history cannot invent the missing lifecycle or error classification',t=>{
  const {recorder}=fixture(t);begin(recorder,{goal:true,src:'official-app-server'});recorder.onQuota(raw(0,0,500),132000,'official-app-server');dispatch(recorder,'official-app-server');
  recorder.onThread({threadId,snapshot:snapshot('inProgress','some-later-turn',{status:'active',objective:'SECRET GOAL'}),decision:{action:'running'},observedAt:150000,source:'desktop-ipc'});
  let c=recorder.report().json.cycles[0];assert.equal(c.status,'INCOMPLETE');assert.equal(c.nextTurnEndAt,null);assert.equal(c.episode.outcome,'UNOBSERVED');assert.ok(!c.reasons.includes('unrelated-next-turn-observed'));
  const stored=recorder.cycles(threadId)[0];stored.nextTurnStatus='failed';stored.nextTurnEndAt=140000;stored.endReal=true;recorder.save();c=recorder.report().json.cycles[0];assert.equal(c.status,'UNKNOWN');assert.equal(c.episode.outcome,'FAILED_ERROR_UNAVAILABLE');assert.ok(c.reasons.includes('failed-next-turn-error-classification-unavailable'));
});
test('historical auto-resume receipt timestamp survives later event observations',t=>{
  const {recorder}=fixture(t);begin(recorder);recorder.onQuota(raw(0,0,500),132000,source);dispatch(recorder);
  recorder.onEngineEvent('auto-resumed',{threadId,observedAt:190000,source});recorder.onEngineEvent('continuation-accepted',{threadId,turnId:next,observedAt:191000,source});
  const c=recorder.report().json.cycles[0];assert.equal(c.autoResumedAt,134000);assert.equal(c.resumeAt,133000);
});
test('an immediately quota-failed resume without a running observation cannot claim continued work',t=>{
  const {recorder}=fixture(t);begin(recorder,{goal:true});recorder.onQuota(raw(0,0,500),132000,source);dispatch(recorder);
  recorder.onThread({threadId,snapshot:snapshot('failed',next,{status:'usageLimited',objective:'SECRET GOAL'}),observedAt:135000,source});
  const c=recorder.report().json.cycles[0];assert.equal(c.episode.outcome,'RESUME_ATTEMPT_QUOTA_LIMITED');assert.ok(c.episode.reasons.includes('continued-work-lifecycle-not-observed'));assert.equal(c.status,'SIMULATED');
});
