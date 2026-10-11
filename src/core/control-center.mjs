import { createHmac,randomBytes } from 'node:crypto';
import { WatchdogEngine } from '../engine.mjs';
import { assess, quotaStatus, isUuid, goalIdentity, latestTurn } from '../policy.mjs';
import { safeRepository } from '../observability/metadata.mjs';
import { ACTIVITY_FRESH_MS, INACTIVITY_THRESHOLD_MS } from '../observability/activity.mjs';

const unavailableActivity=(reason,lastEventAt=null)=>({source:'local-session-log',status:'Unavailable',reason,lastEventAt,pendingRequests:null,executingTools:null,authoritativeToolState:'Unavailable',heuristic:{status:'Unavailable',reason,thresholdMs:INACTIVITY_THRESHOLD_MS,automaticAction:false}});

export const DEFAULT_SETTINGS = Object.freeze({ recoveryPollSeconds: 10, historySampleSeconds: 60, maxConcurrentResumes: 1, reservePercent: 10, maxRetries: 3, cooldownSeconds: 30, autoResume: false });
export const CONTINUATION_TEXT = 'Codex Control Center：实时额度查询已确认所有阻塞窗口可用。请在本聊天继续原有未完成工作；先核对当前进度、工作区和仍在运行的后台命令，接续尚未完成的步骤。保留原目标、模型、权限与预算；若已经完成或需要用户决定，请说明并停止。';
export function observedCurrentGoal(state,observedAt) {
  const source='verified-desktop-ipc';
  if(!Object.hasOwn(state,'threadGoal'))return {presence:'unavailable',source,observedAt};
  if(state.threadGoal===null)return {presence:'none',source,observedAt};
  const goal=state.threadGoal, number=value=>Number.isSafeInteger(value)&&value>=0?value:null;
  const time=value=>number(value)!=null&&Number.isSafeInteger(value*1000)?value*1000:null;
  return {presence:'present',source,observedAt,status:['active','paused','blocked','usageLimited','budgetLimited','complete'].includes(goal?.status)?goal.status:null,
    tokenBudget:number(goal?.tokenBudget),tokenBudgetState:!Object.hasOwn(goal??{},'tokenBudget')?'unavailable':goal.tokenBudget===null?'not-provided':number(goal.tokenBudget)!=null?'reported':'unavailable',tokensUsed:number(goal?.tokensUsed),timeUsedSeconds:number(goal?.timeUsedSeconds),createdAt:time(goal?.createdAt),updatedAt:time(goal?.updatedAt)};
}
export function observedTurnContext(state,turn,{threadId,salt}={}) {
 const canonical=state.turnHistory?.kind==='canonical'&&latestTurn(state)?.turnId===turn?.turnId;
 const started=Number.isSafeInteger(turn?.turnStartedAtMs)&&turn.turnStartedAtMs>=0?turn.turnStartedAtMs:null;
 const ended=Number.isSafeInteger(turn?.turnEndedAtMs)&&turn.turnEndedAtMs>=0?turn.turnEndedAtMs:null;
 const metadata={collaborationMode:typeof state.latestCollaborationMode?.mode==='string'?state.latestCollaborationMode.mode:undefined,modelContextWindow:Number.isSafeInteger(state.modelContextWindow)&&state.modelContextWindow>0?state.modelContextWindow:undefined,turnStartedAtMs:started,turnCompletedAtMs:ended,kind:null,goalId:null,goalAttributionReason:'goal-state-not-observed'};
 if(!canonical){metadata.goalAttributionReason='canonical-turn-relation-unavailable';return metadata;}
 if(!Object.hasOwn(state,'threadGoal'))return metadata;
 if(state.threadGoal===null){metadata.kind='ordinary';metadata.goalAttributionReason='explicit-no-current-goal';return metadata;}
 const goal=state.threadGoal,created=Number.isSafeInteger(goal?.createdAt)&&goal.createdAt>=0?goal.createdAt*1000:null;
 if(created==null||started==null){metadata.goalAttributionReason='goal-or-turn-start-time-unavailable';return metadata;}
 if(started<created){metadata.goalAttributionReason='turn-predates-current-goal';return metadata;}
 if(!['active','usageLimited'].includes(goal.status)){metadata.goalAttributionReason='goal-not-active-turn-relation-unproven';return metadata;}
 if(typeof goal.objective!=='string'||!goal.objective||!salt){metadata.goalAttributionReason='goal-identity-unavailable';return metadata;}
 metadata.kind='goal';metadata.goalId='goal-'+createHmac('sha256',salt).update(JSON.stringify([threadId,goalIdentity(goal)])).digest('hex').slice(0,32);metadata.goalAttributionReason='canonical-turn-starts-within-current-active-goal';return metadata;
}
export function validateSettings(value) {
  const s = { ...DEFAULT_SETTINGS, ...value };
  if (![5,10,30,60].includes(s.recoveryPollSeconds) || !Number.isInteger(s.historySampleSeconds) || s.historySampleSeconds < 60 || !Number.isInteger(s.maxConcurrentResumes) || s.maxConcurrentResumes < 1 || s.maxConcurrentResumes > 20 || !Number.isFinite(s.reservePercent) || s.reservePercent < 0 || s.reservePercent >= 100 || !Number.isInteger(s.maxRetries) || s.maxRetries < 1 || s.maxRetries > 100 || !Number.isFinite(s.cooldownSeconds) || s.cooldownSeconds < 0 || typeof s.autoResume !== 'boolean') throw new Error('invalid-core-settings');
  return s;
}
const defaults = s => ({ autoResume: true, allowAutomaticStart: true, neverAutoResume: false, manualPaused: false, priority: 2, order: 0, maxRetries: s.maxRetries, cooldownSeconds: s.cooldownSeconds, retryCount: 0, nextAttemptAt: 0 });

export class ControlCenterCore {
  constructor({ adapter, store, settings = {}, now = Date.now, execute = false,recorder,observability }) {
    Object.assign(this, { adapter, store, now, execute });
    this.recorder=recorder;
    this.observability=observability;
    this.settings = validateSettings(store.getSetting('core-settings', settings));
    store.setSetting('core-settings',this.settings);
    this.nextQuotaPollAt = 0; this.nextScanAt = 0; this.polling = null; this.nextHistorySampleAt = store.getSetting('next-history-sample-at', 0); this.nextCompatibilityAt = 0;
    this.quota = null; this.lastQuotaPollAt = null; this.lastError = null; this.errorCount = 0; this.active = new Set();this.manualResumes=new Set(); this.stopped = false; this.ticking = false;
    const desktop = { snapshot: id => adapter.snapshot(id),
      request: (method, params, owner) => { this.assertThreadEnabled(params.conversationId); return adapter.desktop.request(method, params, owner); } };
    if (typeof adapter.desktop.getGeneration === 'function') desktop.getGeneration = id => adapter.desktop.getGeneration(id);
    const account={request:async(method,params)=>{const result=await adapter.account.request(method,params);if(method==='account/rateLimits/read')this.recorder?.onQuota(result,this.now(),adapter.source);return result;}};
    this.engine = new WatchdogEngine({ store, desktop, account, now, execute, quotaProbeMode: 'live', resetBufferMs: 0, continuationText: CONTINUATION_TEXT,
      enabled: id => !this.stopped && !this.requiresRecoveryReview() && adapter.compatibility.verified && (this.manualResumes.has(id)||(this.settings.autoResume&&(!id||this.threadEnabled(id)))),
      enrollmentSince: () => this.enrollmentSince,
      verifyDesktop: () => adapter.verifyWriteSafety(), log: (event, details) => {
        store.event(event,details);
        const record=this.engine?.state.records[details.threadId],intent=this.engine?.state.ledger[record?.attemptKey];
        this.recorder?.onEngineEvent(event,{...details,intent,observedAt:this.now(),source:adapter.source});
      } });
    // Never silently enroll work that stopped before this application was enabled.
    this.enrollmentSince = this.settings.autoResume ? store.getSetting('enrollment-since', now()) : now();
    if (this.settings.autoResume) store.setSetting('enrollment-since', this.enrollmentSince);
  }
  setSettings(update) {
    if(update?.autoResume===true&&this.requiresRecoveryReview())throw new Error('database-recovery-review-required');
    const next = validateSettings({ ...this.settings, ...update });
    if (!this.settings.autoResume && next.autoResume) { this.enrollmentSince = this.now(); this.store.setSetting('enrollment-since', this.enrollmentSince); }
    this.settings = next; this.store.setSetting('core-settings', next); this.nextQuotaPollAt = Math.min(this.nextQuotaPollAt, this.now()); return this.snapshot();
  }
  policy(id) { return { ...defaults(this.settings), ...this.store.getThreadPolicy(id) }; }
  observeActivity(record,{canonical=false}={}) {
    if(!this.observability||!isUuid(record?.threadId)||!isUuid(record.currentTurnId))return;
    this.activityObservations??=new WeakMap();
    const previous=this.activityObservations.get(record);
    const slot={turnId:record.currentTurnId,observedAt:record.lastActivityAt,canonical,result:previous?.turnId===record.currentTurnId?previous.result:undefined};this.activityObservations.set(record,slot);
    const params={verified:canonical,threadId:record.threadId,turnId:slot.turnId,status:record.currentTurnStatus,startedAt:record.turnStartedAt,observedAt:slot.observedAt,runtimeType:record.runtimeType,runtimeFlags:record.runtimeFlags};
    return Promise.resolve().then(()=>this.observability.call('activity',params)).then(value=>{
      if(this.engine.state.records[record.threadId]!==record||this.activityObservations.get(record)!==slot||record.currentTurnId!==slot.turnId||record.currentTurnStatus!==params.status)return;
      record.activity=value?.source==='local-session-log'&&typeof value.status==='string'?{...value,projectedAt:this.now()}:unavailableActivity('activity-observation-unavailable');
      slot.result=record.activity;
    }).catch(()=>{
      if(this.activityObservations.get(record)===slot&&record.currentTurnId===slot.turnId){record.activity=unavailableActivity('activity-observation-unavailable');slot.result=record.activity;}
    });
  }
  activityForSnapshot(record) {
    const slot=this.activityObservations?.get(record),value=slot?.result,now=this.now();
    const last=slot?.turnId===record.currentTurnId?value?.lastEventAt:null;
    if(record.currentTurnStatus!=='inProgress')return unavailableActivity('canonical-turn-not-active',last??null);
    if(!slot||slot.canonical!==true||slot.turnId!==record.currentTurnId||!value)return unavailableActivity('activity-observation-unavailable');
    if(!Number.isSafeInteger(value.projectedAt)||!Number.isSafeInteger(value.indexedAt)||value.projectedAt>now+1000||value.indexedAt>now+1000||now-value.projectedAt>ACTIVITY_FRESH_MS||now-value.indexedAt>ACTIVITY_FRESH_MS||now-record.lastActivityAt>ACTIVITY_FRESH_MS)return unavailableActivity('activity-observation-stale',last??null);
    return value;
  }
  requiresRecoveryReview(){return this.store.getSetting('database-recovery',{})?.requiresReview===true;}
  threadEnabled(id) { const p=this.policy(id); return p.autoResume && p.allowAutomaticStart && !p.manualPaused && !p.neverAutoResume; }
  assertThreadEnabled(id) {
    if(this.requiresRecoveryReview())throw new Error('database-recovery-review-required');
    const p = this.policy(id);
    if(this.manualResumes.has(id)&&!this.stopped)return;
    if (!this.settings.autoResume || p.manualPaused || p.neverAutoResume || !p.autoResume || !p.allowAutomaticStart || this.stopped) throw new Error('thread-auto-resume-disabled');
  }
  setThreadPolicy(id, update) {
    if(update?.autoResume===true&&this.requiresRecoveryReview())throw new Error('database-recovery-review-required');
    if (!isUuid(id)) throw new Error('invalid-thread-id');
    const allowed = ['autoResume','allowAutomaticStart','neverAutoResume','manualPaused','priority','order','maxRetries','cooldownSeconds'];
    if (Object.keys(update).some(k => !allowed.includes(k))) throw new Error('unknown-thread-policy-field');
    const policy = { ...this.policy(id), ...update };
    if (['autoResume','allowAutomaticStart','neverAutoResume','manualPaused'].some(k => typeof policy[k] !== 'boolean') || !Number.isInteger(policy.priority) || policy.priority < 0 || policy.priority > 3 || !Number.isInteger(policy.order) || !Number.isInteger(policy.maxRetries) || policy.maxRetries < 1 || !Number.isFinite(policy.cooldownSeconds) || policy.cooldownSeconds < 0) throw new Error('invalid-thread-policy');
    this.recorder?.onManualAction({threadId:id,action:'policy-change',observedAt:this.now()});
    this.store.setThreadPolicy(id, policy); this.store.event('thread-policy-updated', { threadId: id, changed: Object.keys(update) }); return policy;
  }
  async pollQuota() {
    if (this.polling) return this.polling;
    if (this.stopped || this.now() < this.nextQuotaPollAt) return this.quota;
    this.polling = (async () => {
      try {
        await this.adapter.connect();
        const raw = await this.adapter.readQuota(); this.lastQuotaPollAt = this.now(); this.quota = quotaStatus(raw,this.now());
        this.recorder?.onQuota(raw,this.lastQuotaPollAt,this.adapter.source);
        const bucket=raw?.rateLimitsByLimitId?.codex??raw?.rateLimits;
        this.quota.windows=[bucket?.primary,bucket?.secondary].filter(Boolean).map(w=>({durationMinutes:w.windowDurationMins??null,usedPercent:w.usedPercent??null,remainingPercent:Number.isFinite(w.usedPercent)?100-w.usedPercent:null,resetsAt:Number.isFinite(w.resetsAt)?w.resetsAt*1000:null}));
        this.quota.planType=typeof bucket?.planType==='string'?bucket.planType:null;
        this.quota.credits=bucket?.credits?{hasCredits:bucket.credits.hasCredits??null,unlimited:bucket.credits.unlimited??null,balance:bucket.credits.balance??null}:null;
        if (this.now() >= this.nextHistorySampleAt) {
          this.store.sampleQuota(raw,this.now(),this.adapter.source,this.adapter.compatibility.cliVersion ?? null);
          this.nextHistorySampleAt = this.now()+this.settings.historySampleSeconds*1000; this.store.setSetting('next-history-sample-at',this.nextHistorySampleAt);
          if(this.now()-(this.store.getSetting('history-maintained-at',0))>=86400000)this.store.maintainHistory(this.now());
        }
        this.lastError = null; this.errorCount = 0; this.nextQuotaPollAt = this.now()+this.settings.recoveryPollSeconds*1000;
        if(this.execute && this.settings.autoResume && this.quota.known && this.quota.ready && this.adapter.compatibility.verified) {
          try { await this.schedule(); } catch(error) { this.store.event('scheduler-error',{reason:error.message}); }
        }
        return this.quota;
      } catch (error) {
        this.lastError = error.message; this.errorCount++;
        this.quota = { known:false,ready:false,reason:'quota-query-failed' };
        this.nextQuotaPollAt = this.now()+Math.min(300000,this.settings.recoveryPollSeconds*1000*2**Math.min(this.errorCount,5));
        this.store.event('connection-backoff',{reason:error.message,retryAt:this.nextQuotaPollAt});
        await this.adapter.close(); return this.quota;
      }
    })();
    try { return await this.polling; } finally { this.polling=null; }
  }
  async tick() {
    if (this.stopped || this.ticking || this.now() < this.nextScanAt) return this.snapshot();
    this.ticking = true;
    try {
      if (this.now() >= this.nextCompatibilityAt) { this.adapter.probeCompatibility(); this.nextCompatibilityAt = this.now() + 60000; }
      await this.pollQuota();
      if (this.lastError && !this.quota?.known) { this.nextScanAt=this.nextQuotaPollAt; return this.snapshot(); }
      const ids = new Set(await this.adapter.listThreads(this.now()));
      for (const [id,r] of Object.entries(this.engine.state.records)) if (r.failureTurnId) ids.add(id);
      for (const id of ids) {
        if(this.active.has(id))continue;
        if (!await this.adapter.isEligible(id)) {
          const r = this.engine.state.records[id]; if (r) { this.engine.transition(r,'inactive','archived-or-no-longer-root'); delete r.failureTurnId; } continue;
        }
        if (!this.adapter.compatibility.verified) continue;
        try {
          const { state } = await this.adapter.snapshot(id); this.lastThreadObservationAt = this.now(); const decision = assess(state, { catalogPersistent: true });
          const pending=this.engine.state.records[id];
          if(pending?.failureTurnId&&(state.resumeState!=='resumed'||state.threadRuntimeStatus?.type==='notLoaded')){
            pending.unavailableReason='desktop-thread-loading';this.engine.transition(pending,'waitingQuota','desktop-loading');if(state.resumeState==='resumed'&&state.threadRuntimeStatus?.type==='notLoaded')await this.reopenPending(pending);continue;
          }
          const turn=latestTurn(state);
          const outstanding=Object.values(this.engine.state.ledger).filter(i=>i.threadId===id&&(['sent','uncertain','dispatching'].includes(i.phase)||i.lifecycle==='running'));
          for(const intent of outstanding)if(turn && turn.turnId!==intent.failureTurnId){intent.phase='confirmed';intent.confirmedTurnId=turn.turnId;intent.lifecycle=['completed','failed','interrupted'].includes(turn.status)?'finished':'running';}
          // A transport ACK may precede the desktop's read-after-write snapshot.
          // Keep that resume's slot and never reinterpret the old failed turn as a new incident.
          const acknowledgedLag=outstanding.some(i=>i.phase==='sent'&&turn?.turnId===i.failureTurnId);
          if(!acknowledgedLag)this.engine.observe(id, state, this.quota);
          const record = this.engine.state.records[id];
          if(record&&decision.action==='quotaFailure'){
            const policy=this.policy(id);if(policy.retryCount>=policy.maxRetries){policy.autoResume=false;this.store.setThreadPolicy(id,policy);this.engine.transition(record,'needsAttention','retry-limit-reached');}
          }
          if(record&&(decision.reason==='completed'||['complete','completed'].includes(state.threadGoal?.status)||state.completedThreadGoal?.status==='complete')){
            const policy=this.policy(id);if(policy.retryCount){policy.retryCount=0;policy.nextAttemptAt=0;this.store.setThreadPolicy(id,policy);}
          }
          this.recorder?.onThread({threadId:id,snapshot:state,decision,record,intent:this.engine.state.ledger[record?.attemptKey],observedAt:this.now(),source:this.adapter.source==='official-app-server'?'desktop-ipc':this.adapter.source,versions:{cliVersion:this.adapter.compatibility.cliVersion,desktopVersion:this.adapter.compatibility.desktopVersion}});
          if(record) {
            record.title=typeof state.title==='string'?state.title:typeof state.threadTitle==='string'?state.threadTitle:null;
            record.workspace=typeof state.cwd==='string'?state.cwd:null;
            record.modelId=state.latestModel??null;record.reasoningEffort=state.latestReasoningEffort??null;
            record.serviceTier=state.latestThreadSettings?.serviceTier??null;record.lastActivityAt=this.now();
            record.repository=safeRepository(state.gitInfo?.originUrl);
            record.currentGoal=observedCurrentGoal(state,this.now());
            record.currentTurnId=turn?.turnId??null;record.currentTurnStatus=turn?.status??null;
            record.turnStartedAt=Number.isFinite(turn?.turnStartedAtMs)?turn.turnStartedAtMs:null;
            record.turnEndedAt=Number.isFinite(turn?.turnEndedAtMs)?turn.turnEndedAtMs:null;
            record.runtimeType=state.threadRuntimeStatus?.type??null;
            record.runtimeFlags=Array.isArray(state.threadRuntimeStatus?.activeFlags)?state.threadRuntimeStatus.activeFlags.filter(flag=>typeof flag==='string'):[];
            record.collaborationMode=typeof state.latestCollaborationMode?.mode==='string'?state.latestCollaborationMode.mode:null;
            record.modelContextWindow=Number.isFinite(state.modelContextWindow)?state.modelContextWindow:null;
            record.quotaAttribution={status:'Unavailable',reason:'Subscription quota changes cannot be reliably assigned to a concurrent thread'};
            record.metadataSource='verified-desktop-ipc';
            delete record.unavailableReason;
            void this.observeActivity(record,{canonical:state.turnHistory?.kind==='canonical'});
          }
          if(this.observability&&turn?.turnId){let salt=this.store.getSetting('observability:goal-key-salt',null);if(!salt){salt=randomBytes(32).toString('hex');this.store.setSetting('observability:goal-key-salt',salt);}const context=observedTurnContext(state,turn,{threadId:id,salt});if(record)record.goalAttribution={status:context.kind==='goal'?'Observed':context.kind==='ordinary'?'Not a Goal':'Unavailable',reason:context.goalAttributionReason};void this.observability.call('observe-turn',{threadId:id,turnId:turn.turnId,...context,repository:safeRepository(state.gitInfo?.originUrl),model:typeof state.latestModel==='string'?state.latestModel:undefined,rawServiceTier:turn.params?.serviceTier??state.latestThreadSettings?.serviceTier,effort:state.latestReasoningEffort,observedAt:this.now(),source:this.adapter.source==='official-app-server'?'desktop-ipc':this.adapter.source}).catch(()=>{});}
          if (record && decision.action === 'wait' && ['approval-or-input-pending','user-message-pending','goal-user-confirmation'].includes(decision.reason)) { this.engine.transition(record,'needsUser',decision.reason); }
        } catch (error) {
          if (!['no-client-found','desktop-snapshot-timeout','desktop-read-compatibility-unverified'].includes(error.message)) throw error;
          const record = this.engine.state.records[id];
          if (record) {
            record.unavailableReason = error.message;
            await this.reopenPending(record);
          }
        } finally { this.adapter.unfollow?.(id); }
      }
      this.engine.save();
      if (this.execute && this.settings.autoResume && this.quota.known && this.quota.ready && this.adapter.compatibility.verified) await this.schedule();
      this.nextScanAt = this.now()+this.settings.recoveryPollSeconds*1000;
    } catch (error) {
      this.lastError = error.message; this.errorCount++;
      const delay = Math.min(300000, this.settings.recoveryPollSeconds*1000*2**Math.min(this.errorCount,5));
      this.nextScanAt = this.now()+delay;
      this.store.event('thread-observation-backoff', { reason: error.message, retryAt: this.nextScanAt });
      await this.adapter.close();
    } finally { this.ticking = false; }
    return this.snapshot();
  }
  async schedule() {
    const queue = Object.values(this.engine.state.records).filter(r => r.failureTurnId && r.phase === 'waitingQuota' && !r.unavailableReason).map(r => ({ r, p: this.policy(r.threadId) }))
      .filter(({r,p}) => p.autoResume && p.allowAutomaticStart && !p.neverAutoResume && !p.manualPaused && p.retryCount < p.maxRetries && p.nextAttemptAt <= this.now() && (p.priority < 2 || (this.quota.fiveHourRemainingPercent ?? this.quota.remainingPercent) > this.settings.reservePercent))
      .sort((a,b) => a.p.priority-b.p.priority || a.r.failedAt-b.r.failedAt || a.p.order-b.p.order);
    // Occupancy includes already resumed work; avoid releasing a slot merely on receipt of a start acknowledgement.
    const available = Math.max(0,this.settings.maxConcurrentResumes-this.occupiedThreads().size);
    await Promise.all(queue.slice(0,available).map(({r,p}) => this.dispatch(r,p)));
  }
  async reopenPending(record){
    const id=record.threadId;if(!this.execute||!this.settings.autoResume||!this.threadEnabled(id)||!this.quota?.ready||!record.failureTurnId||record.phase!=='waitingQuota'||this.now()<(record.lastOpenAttemptAt??0)+120000||typeof this.adapter.reopen!=='function')return;
    let canOpen=true;
    if(record.kind==='goal'){const {goal}=await this.adapter.account.request('thread/goal/get',{threadId:id});canOpen=goal?.status==='usageLimited'&&goalIdentity(goal)===record.goalIdentity;}
    if(canOpen){record.lastOpenAttemptAt=this.now();this.adapter.reopen(id);this.store.event('opening-pending-chat',{threadId:id});}
  }
  async dispatch(record, policy) {
    if (this.active.has(record.threadId) || this.stopped || (!this.settings.autoResume&&!this.manualResumes.has(record.threadId))) return false;
    this.active.add(record.threadId);
    try {
      this.assertThreadEnabled(record.threadId);
      if(!await this.adapter.isEligible(record.threadId)){this.engine.transition(record,'inactive','archived-or-no-longer-root');delete record.failureTurnId;this.engine.save();return false;}
      this.adapter.verifyWriteSafety();
      const ok = await this.engine.recover(record.threadId);
      if (ok) { if(!this.manualResumes.has(record.threadId))policy.retryCount++;policy.nextAttemptAt = 0; this.store.event('auto-resumed',{ threadId:record.threadId,manual:this.manualResumes.has(record.threadId) });this.recorder?.onEngineEvent('auto-resumed',{threadId:record.threadId,intent:this.engine.state.ledger[record.attemptKey],observedAt:this.now(),source:this.adapter.source}); }
      else if (record.phase === 'needsAttention') { policy.retryCount++; policy.autoResume = false; this.store.event('resume-needs-attention',{ threadId:record.threadId, reason:record.reason }); }
      else if (record.phase === 'waitingQuota' && record.reason === 'desktop-state-changed-before-send') { policy.retryCount++; policy.nextAttemptAt = this.now()+policy.cooldownSeconds*1000; }
      if (!ok&&policy.retryCount >= policy.maxRetries) { policy.autoResume = false; this.engine.transition(record,'needsAttention','retry-limit-reached'); }
      const current=this.policy(record.threadId);
      current.retryCount=policy.retryCount;current.nextAttemptAt=policy.nextAttemptAt;
      if(record.phase==='needsAttention')current.autoResume=false;
      this.store.setThreadPolicy(record.threadId,current); this.engine.save(); return ok;
    } catch(error) {
      if(['no-client-found','desktop-snapshot-timeout','desktop-disconnected'].includes(error.message)) {
        record.unavailableReason=error.message;this.engine.transition(record,'waitingQuota','desktop-unavailable');this.engine.save();return false;
      }
      throw error;
    } finally { this.active.delete(record.threadId); this.adapter.unfollow?.(record.threadId); }
  }
  snapshot() {
    return { mode: this.execute ? 'execute' : 'observe', settings: this.settings, compatibility: this.adapter.compatibility, quota: this.quota,adapter:this.adapter.source,database:{schemaVersion:this.store.db?.prepare('PRAGMA user_version').get().user_version??null,recovery:this.store.getSetting('database-recovery',{}),requiresReview:this.requiresRecoveryReview()},
      lastQuotaPollAt: this.lastQuotaPollAt, nextQuotaPollAt: this.nextQuotaPollAt, nextHistorySampleAt: this.nextHistorySampleAt, lastError: this.lastError,
      tasks: Object.values(this.engine.state.records).map(r => ({ ...r, activity:this.activityForSnapshot(r),policy: this.policy(r.threadId),nextRecoveryCheckAt:this.nextQuotaPollAt,tokenUsage:{status:'Available through separate observed analytics ledgers; not a reconciled global consumption total',source:'local-session-log'} })), activeResumes: this.active.size };
  }
  occupiedThreads() {
    const occupied=new Set(Object.values(this.engine.state.records).filter(r=>r.phase==='watching'&&['running','continuation-accepted','new-turn-observed','goal-between-turns'].includes(r.reason)).map(r=>r.threadId));
    for(const intent of Object.values(this.engine.state.ledger))if(['sent','uncertain','dispatching'].includes(intent.phase)||intent.lifecycle==='running')occupied.add(intent.threadId);
    for(const id of this.active)occupied.add(id);
    for(const id of this.manualResumes)occupied.add(id);
    return occupied;
  }
  async resumeNow(id) {
    if(this.requiresRecoveryReview())throw new Error('database-recovery-review-required');
    if(!isUuid(id))throw new Error('invalid-thread-id');
    this.recorder?.onManualAction({threadId:id,action:'resume-now',observedAt:this.now()});
    if(!this.execute)throw new Error('observe-mode-cannot-resume');
    const record=this.engine.state.records[id];
    if(!record?.failureTurnId||record.phase!=='waitingQuota')throw new Error('thread-not-eligible-for-quota-resume');
    if(this.active.has(id)||this.manualResumes.has(id))throw new Error('resume-already-in-flight');
    if(this.occupiedThreads().size>=this.settings.maxConcurrentResumes)throw new Error('resume-concurrency-limit');
    this.manualResumes.add(id);
    try{const raw=await this.adapter.readQuota();this.recorder?.onQuota(raw,this.now(),this.adapter.source);const quota=quotaStatus(raw,this.now());if(!quota.known||!quota.ready)throw new Error(quota.reason);return{resumed:await this.dispatch(record,this.policy(id))};}finally{this.manualResumes.delete(id);}
  }
  async close() { this.stopped = true; if(this.polling) await this.polling; await this.adapter.close(); }
}
