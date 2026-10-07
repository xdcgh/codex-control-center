import { createHmac, randomBytes } from 'node:crypto';
import { quotaStatus, latestTurn, goalIdentity } from '../policy.mjs';
const KEY='natural-cycle:v1';
const real=s=>['official-app-server','desktop-ipc','live-production'].includes(s);
const synthetic=s=>typeof s==='string'&&/mock|fake|fixture|synthetic|simulat|test/i.test(s);
const clean=v=>typeof v==='string'&&/^[a-zA-Z0-9._-]{1,100}$/.test(v)?v:null;
const timestamp=v=>Number.isSafeInteger(v)&&v>=0?v:null;
const version=v=>typeof v==='string'&&/^v?\d[0-9a-zA-Z.+-]{0,60}$/.test(v)?v:null;
const versions=v=>({cliVersion:version(v?.cliVersion),desktopVersion:version(v?.desktopVersion)});
const quotaError=t=>['usageLimitExceeded','UsageLimitExceeded'].includes(t?.error?.codexErrorInfo);
function historyTurns(snapshot) {
  const history=snapshot.turnHistory?.kind==='canonical'?Object.values(snapshot.turnHistory.history?.entitiesByKey??{}):[];
  return [...history,...(Array.isArray(snapshot.turns)?snapshot.turns:[])].filter(t=>t&&typeof t.turnId==='string');
}

// This recorder observes evidence only. It never dispatches work or mutates a Goal.
export class NaturalCycleRecorder {
  constructor({store,now=Date.now,quotaMaxAgeMs=20000}) {
    this.store=store;this.now=now;this.quotaMaxAgeMs=quotaMaxAgeMs;
    this.state=store.getSetting(KEY,{salt:randomBytes(32).toString('hex'),working:{},cycles:{},quota:null});
  }
  save() { this.store.setSetting(KEY,this.state); }
  fingerprint(v) { return createHmac('sha256',this.state.salt).update(String(v)).digest('hex').slice(0,24); }
  onQuota(raw,observedAt=this.now(),source='unknown') {
    if(timestamp(observedAt)==null) throw new Error('invalid-observation-time');
    const normalized=raw?.known!==undefined, q=normalized?raw:quotaStatus(raw,observedAt);
    const bucket=raw?.rateLimitsByLimitId?.codex??raw?.rateLimits;
    const windows=(normalized?(raw.windows??[]):[bucket?.primary,bucket?.secondary]).filter(Boolean).map(w=>({minutes:w.durationMinutes??w.windowDurationMins,usedPercent:w.usedPercent,resetsAt:normalized?timestamp(w.resetsAt):timestamp(w.resetsAt*1000)}));
    const valid=windows.length>0&&windows.every(w=>Number.isFinite(w.minutes)&&w.minutes>0&&Number.isFinite(w.usedPercent)&&w.usedPercent>=0&&w.usedPercent<=100&&(w.usedPercent===0||w.resetsAt!=null&&w.resetsAt>observedAt));
    const quota={observedAt,real:real(source),synthetic:synthetic(source),known:q.known===true&&valid,ready:q.ready===true&&valid&&windows.every(w=>w.usedPercent<100),windows};
    this.state.quota=quota;
    for(const c of Object.values(this.state.cycles)) {
      if(c.detectedRecoveryAt!=null||c.waitingRecordedAt==null||observedAt<c.waitingRecordedAt) continue;
      const all=(quota.real||quota.synthetic)&&quota.known&&quota.ready&&c.blockingWindows.length>0&&c.blockingWindows.every(b=>windows.some(w=>w.minutes===b.minutes&&w.usedPercent<100));
      if(all) { c.detectedRecoveryAt=observedAt;c.recoveryReal=quota.real;c.syntheticEvidence||=quota.synthetic; }
    }
    this.save();return quota;
  }
  onThread({threadId,snapshot,decision,record,intent,observedAt=this.now(),source='unknown',versions:observedVersions}={}) {
    if(typeof threadId!=='string'||!threadId||timestamp(observedAt)==null||snapshot?.id!==threadId) return;
    const turn=latestTurn(snapshot), turnId=turn?.turnId, structured=turn?.status==='failed'&&quotaError(turn),history=historyTurns(snapshot);
    if((decision?.action==='running'||turn?.status==='inProgress')&&turnId) this.state.working[threadId]={observedAt,turnId,real:real(source),synthetic:synthetic(source)};
    if((structured||decision?.action==='quotaFailure')&&turnId) {
      const key=this.fingerprint(threadId+':'+turnId);
      let c=this.state.cycles[key];
      if(!c) {
        const quota=this.state.quota,working=this.state.working[threadId], contemporaneous=quota&&quota.observedAt<=observedAt&&observedAt-quota.observedAt<=this.quotaMaxAgeMs;
        const blocking=contemporaneous&&quota.known&&!quota.ready?quota.windows.filter(w=>w.usedPercent>=100):[];
        c=this.state.cycles[key]={id:key,threadId,failureTurnId:turnId,kind:snapshot.threadGoal?'goal':'ordinary',model:clean(snapshot.latestModel),versions:versions(observedVersions),failureObservedAt:observedAt,structuredFailure:structured,workingBeforeFailure:!!working&&working.turnId===turnId&&working.observedAt<observedAt,workingObservedAt:working?.observedAt??null,workingReal:working?.real===true,failureReal:real(source),blockedQuotaReal:contemporaneous&&quota?.real===true,blockedQuotaObservedAt:contemporaneous?quota.observedAt:null,blockingWindows:blocking,originalExhaustedResetsAt:blocking.length?Math.max(...blocking.map(w=>w.resetsAt)):null,dispatches:[],receipt:false,manualOverride:false,uncertain:false};
        c.syntheticEvidence=synthetic(source)||working?.synthetic===true||contemporaneous&&quota?.synthetic===true;
        c.failureTurnStartedAt=timestamp(turn.turnStartedAtMs);c.failureTurnEndedAt=timestamp(turn.turnCompletedAtMs);
        c.goalFingerprint=snapshot.threadGoal?this.fingerprint(goalIdentity(snapshot.threadGoal)):null;
      }
      if(record?.phase==='waitingQuota'&&c.waitingRecordedAt==null) c.waitingRecordedAt=observedAt;
    }
    for(const c of this.cycles(threadId)) {
      if(c.kind==='goal'&&c.goalCompletedAt!=null) continue;
      c.syntheticEvidence||=synthetic(source);
      if(intent) this.observeIntent(c,intent,observedAt,source);
      const successor=this.cycles(threadId).find(n=>n.id!==c.id&&n.failureTurnId===c.nextTurnId&&n.goalFingerprint===c.goalFingerprint&&n.structuredFailure);
      if(successor) { c.successorCycleFingerprint=successor.id;c.unrelatedTurnObserved=false; }
      // A later tail belongs to a later episode. Resolve this episode's confirmed
      // target from history instead of attributing whichever turn is newest.
      const target=c.nextTurnId?history.find(t=>t.turnId===c.nextTurnId):null;
      if(target) {
        c.observedNextTurnId=target.turnId;c.nextTurnObservedAt??=observedAt;c.nextTurnSeenReal=real(source);c.nextTurnStatus=target.status;
        c.nextTurnStartedAt??=timestamp(target.turnStartedAtMs);
        if(target.status==='inProgress') c.nextTurnRunningObservedAt??=observedAt;
        if(['completed','failed','interrupted'].includes(target.status)) {
          c.nextTurnEndAt??=observedAt;c.endReal=real(source);
          c.nextTurnErrorCode=quotaError(target)?'usageLimitExceeded':target.error?.codexErrorInfo?'other-error':null;
          c.nextTurnCompletedAt??=timestamp(target.turnCompletedAtMs);
        }
        if(c.unrelatedTurnObserved&&c.receipt&&c.dispatches.length===1) c.unrelatedTurnObserved=false;
      } else if(turnId&&turnId!==c.failureTurnId&&!c.nextTurnId) {
        c.unconfirmedNextTurnObserved=true;
      }
      const currentGoal=snapshot.threadGoal??snapshot.completedThreadGoal;
      if(c.kind==='goal'&&currentGoal&&this.fingerprint(goalIdentity(currentGoal))!==c.goalFingerprint) c.goalChanged=true;
      if(c.kind==='goal'&&!c.goalChanged&&['complete','completed'].includes(currentGoal?.status)) { c.goalCompletedAt??=observedAt;c.goalCompletionReal=real(source); }
    }
    this.save();
  }
  cycles(threadId) { return Object.values(this.state.cycles).filter(c=>c.threadId===threadId); }
  observeIntent(c,intent,observedAt,source) {
    if(intent.failureTurnId!==c.failureTurnId) return;
    c.syntheticEvidence||=synthetic(source);
    if(['dispatching','sent','confirmed','uncertain'].includes(intent.phase)&&timestamp(intent.sentAt)!=null&&intent.messageId) {
      const key=this.fingerprint(intent.messageId+':'+intent.sentAt);
      if(!c.dispatches.some(d=>d.id===key)) c.dispatches.push({id:key,sentAt:intent.sentAt,real:real(source)});
    }
    if(intent.phase==='uncertain') c.uncertain=true;
    if(intent.phase==='sent'&&intent.confirmedTurnId) { c.receipt=true;c.nextTurnId=intent.confirmedTurnId;c.resumeAt??=observedAt;c.receiptReal=real(source); }
    // A snapshot-confirmed intent alone cannot prove a transport receipt or automatic delivery.
    if(intent.phase==='confirmed'&&intent.confirmedTurnId) c.nextTurnId??=intent.confirmedTurnId;
  }
  onEngineEvent(event,details={}) {
    const at=details.observedAt??this.now();if(timestamp(at)==null) return;
    const targetFailure=details.failureTurnId??details.intent?.failureTurnId;
    const candidates=this.cycles(details.threadId).filter(c=>!targetFailure||c.failureTurnId===targetFailure);
    for(const c of targetFailure?candidates:candidates.slice(-1)) {
      if(details.failureTurnId&&details.failureTurnId!==c.failureTurnId) continue;
      c.syntheticEvidence||=synthetic(details.source);
      if(details.intent) this.observeIntent(c,details.intent,at,details.source);
      if(event==='task-state'&&details.phase==='waitingQuota') c.waitingRecordedAt??=at;
      if(event==='task-state'&&details.phase==='needsAttention') c.uncertain=true;
      if(event==='continuation-accepted'&&details.turnId) { c.receipt=true;c.receiptReal=real(details.source);c.nextTurnId=details.turnId;c.resumeAt??=at; }
      if(event==='auto-resumed') { c.autoResumedAt??=at;c.autoResumeReal=real(details.source); }
      if(event==='delivery-uncertain') c.uncertain=true;
    }
    this.save();
  }
  onManualAction({threadId,observedAt=this.now()}={}) {
    if(timestamp(observedAt)==null) return;
    for(const c of Object.values(this.state.cycles)) if((threadId==null||c.threadId===threadId)&&(c.kind==='goal'?c.goalCompletedAt==null:c.nextTurnEndAt==null)) { c.manualOverride=true;c.manualActionAt=observedAt; }
    this.save();
  }
  report({threadId,versions:reportedVersions,commit}={}) {
    const cycles=(threadId?this.cycles(threadId):Object.values(this.state.cycles)).map(c=>{
      const reasons=[];
      if(!c.structuredFailure) reasons.push('structured-turn-usage-limit-exceeded-not-observed');
      if(!c.model) reasons.push('model-metadata-unavailable');
      if(!c.versions.cliVersion||!c.versions.desktopVersion) reasons.push('observed-codex-desktop-versions-unavailable');
      if(!c.workingBeforeFailure) reasons.push('same-turn-working-not-recorded-before-failure');
      if(!c.blockingWindows.length) reasons.push('contemporaneous-known-exhausted-quota-not-observed');
      if(!c.waitingRecordedAt) reasons.push('waiting-cycle-not-recorded');
      if(c.detectedRecoveryAt==null) reasons.push('all-blocking-windows-live-recovery-not-observed');
      if(!c.dispatches.length) reasons.push('dispatch-intent-missing');
      if(!c.receipt) reasons.push('transport-receipt-missing');
      if(c.autoResumedAt==null) reasons.push('automatic-resume-event-missing');
      const episodeReasons=[...reasons];
      if(c.observedNextTurnId!==c.nextTurnId||!c.nextTurnId||!(c.nextTurnSeenReal||c.endReal)) episodeReasons.push('confirmed-next-turn-lifecycle-not-observed');
      const continuedObserved=c.nextTurnRunningObservedAt!=null||c.nextTurnStatus==='inProgress'||c.nextTurnStatus==='completed'||c.nextTurnObservedAt!=null&&c.nextTurnEndAt!=null&&c.nextTurnObservedAt<c.nextTurnEndAt;
      if(!continuedObserved) episodeReasons.push('continued-work-lifecycle-not-observed');
      if(c.nextTurnEndAt==null) reasons.push('next-turn-end-not-observed');
      if(c.kind==='goal'&&c.goalCompletedAt==null) reasons.push('goal-completion-not-observed');
      const allReal=[c.failureReal,c.workingReal,c.blockedQuotaReal,...c.dispatches.map(d=>d.real)].every(Boolean)&&(c.detectedRecoveryAt==null||c.recoveryReal)&&( !c.receipt||c.receiptReal)&&(c.autoResumedAt==null||c.autoResumeReal)&&(c.nextTurnEndAt==null||c.endReal)&&(c.goalCompletedAt==null||c.goalCompletionReal);
      if(!allReal) { reasons.push('real-source-provenance-incomplete');episodeReasons.push('real-source-provenance-incomplete'); }
      const repeatedQuota=c.nextTurnStatus==='failed'&&c.nextTurnErrorCode==='usageLimitExceeded';
      const failedOther=c.nextTurnStatus==='failed'&&c.nextTurnErrorCode==='other-error';
      const failedUnknown=c.nextTurnStatus==='failed'&&!c.nextTurnErrorCode;
      const turnOutcome=repeatedQuota?(continuedObserved?'CONTINUED_THEN_QUOTA_LIMITED':'RESUME_ATTEMPT_QUOTA_LIMITED'):failedOther?'FAILED_OTHER_ERROR':failedUnknown?'FAILED_ERROR_UNAVAILABLE':c.nextTurnStatus==='interrupted'?'INTERRUPTED':c.nextTurnStatus==='completed'?'TURN_COMPLETED':c.nextTurnStatus==='inProgress'?'CONTINUING':'UNOBSERVED';
      let status=reasons.length?'INCOMPLETE':'PASS';
      if(c.manualOverride||c.uncertain||c.unrelatedTurnObserved||c.goalChanged||c.dispatches.length&&!c.receipt) status='UNKNOWN';
      if(failedUnknown) { status='UNKNOWN';reasons.push('failed-next-turn-error-classification-unavailable'); }
      if(repeatedQuota) { if(status==='PASS') status='INCOMPLETE';reasons.push('continued-then-quota-limited-again'); }
      if(c.dispatches.length>1||failedOther||c.nextTurnStatus==='interrupted') status='FAIL';
      if(c.syntheticEvidence) status='SIMULATED';
      if(c.manualOverride) reasons.push('manual-override-observed');if(c.uncertain) reasons.push('uncertain-delivery-observed');if(c.unrelatedTurnObserved) reasons.push('unrelated-next-turn-observed');if(c.goalChanged) reasons.push('goal-identity-changed');if(c.dispatches.length>1) reasons.push('duplicate-dispatch-observed');
      const reset=c.originalExhaustedResetsAt,detected=c.detectedRecoveryAt??null,resume=c.resumeAt??null;
      let episodeStatus=episodeReasons.length?'INCOMPLETE':'PASS';
      if(c.manualOverride||c.uncertain||c.goalChanged||c.unrelatedTurnObserved||failedUnknown||c.dispatches.length&&!c.receipt) episodeStatus='UNKNOWN';
      if(c.dispatches.length>1||failedOther||c.nextTurnStatus==='interrupted') episodeStatus='FAIL';
      if(c.syntheticEvidence) episodeStatus='SIMULATED';
      return {cycleFingerprint:c.id,threadFingerprint:this.fingerprint(c.threadId),failureTurnFingerprint:this.fingerprint(c.failureTurnId),nextTurnFingerprint:c.nextTurnId?this.fingerprint(c.nextTurnId):null,kind:c.kind,model:c.model,versions:c.versions,status,reasons,episode:{status:episodeStatus,outcome:turnOutcome,reasons:episodeReasons},goalOutcome:c.kind==='goal'?(c.goalChanged?'UNKNOWN':c.goalCompletedAt!=null?'COMPLETED':'PENDING'):null,successorCycleFingerprint:c.successorCycleFingerprint??null,nextTurnStatus:c.nextTurnStatus??null,nextTurnErrorCode:c.nextTurnErrorCode??null,nextTurnLifecycleObservedAt:c.nextTurnObservedAt??null,nextTurnStartedAt:c.nextTurnStartedAt??null,nextTurnCompletedAt:c.nextTurnCompletedAt??null,failureObservedAt:c.failureObservedAt,failureTurnStartedAt:c.failureTurnStartedAt??null,failureTurnEndedAt:c.failureTurnEndedAt??null,workingObservedAt:c.workingObservedAt,blockedQuotaObservedAt:c.blockedQuotaObservedAt,waitingRecordedAt:c.waitingRecordedAt??null,originalExhaustedResetsAt:reset,detectedRecoveryAt:detected,dispatchedAt:c.dispatches[0]?.sentAt??null,resumeAt:resume,autoResumedAt:c.autoResumedAt??null,nextTurnEndAt:c.nextTurnEndAt??null,goalCompletedAt:c.goalCompletedAt??null,dispatchCount:c.dispatches.length,duplicateDispatch:c.dispatches.length>1?'OBSERVED':c.dispatches.length===1&&c.nextTurnEndAt!=null?'NOT_OBSERVED':'UNKNOWN',receipt:c.receipt?'OBSERVED':'UNKNOWN',detectionLatencyMs:reset!=null&&detected!=null&&detected>=reset?detected-reset:null,resumeLatencyMs:reset!=null&&resume!=null&&resume>=reset?resume-reset:null,timingQuality:'Client wall-clock observations versus reported server reset (seconds precision); resume time is receipt time; poll/network/clock uncertainty applies'};
    });
    const overall=!cycles.length?'NOT_OBSERVED':cycles.every(c=>c.status==='SIMULATED')?'SIMULATED':['FAIL','UNKNOWN','INCOMPLETE','SIMULATED','PASS'].find(s=>cycles.some(c=>c.status===s));
    const json={schemaVersion:1,status:overall,generatedAt:this.now(),versions:versions(reportedVersions),commit:typeof commit==='string'&&/^[a-f0-9]{7,40}$/.test(commit)?commit:null,cycles};
    const markdown=['# Natural quota cycle evidence',`Status: ${json.status}`,`Cycles: ${cycles.length}`,'',...cycles.flatMap(c=>[`## Cycle ${c.cycleFingerprint}`,`Status: ${c.status}`,`Recovery episode: ${c.episode.status}; outcome: ${c.episode.outcome}`,`Overall Goal: ${c.goalOutcome??'Not a Goal'}`,`Kind: ${c.kind}; model: ${c.model??'Unavailable'}`,`Detected recovery: ${c.detectedRecoveryAt??'Not observed'}`,`Original exhausted reset: ${c.originalExhaustedResetsAt??'Unavailable'}`,`Resume: ${c.resumeAt??'Not observed'}`,`Dispatches: ${c.dispatchCount}; receipt: ${c.receipt}`,`Reasons: ${c.reasons.join(', ')||'Required evidence observed'}`,c.timingQuality,''])].join('\n');
    return {json,markdown};
  }
}
