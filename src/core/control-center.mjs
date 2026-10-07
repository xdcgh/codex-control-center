import { WatchdogEngine } from '../engine.mjs';
import { assess, quotaStatus, isUuid, goalIdentity, latestTurn } from '../policy.mjs';

export const DEFAULT_SETTINGS = Object.freeze({ recoveryPollSeconds: 10, historySampleSeconds: 60, maxConcurrentResumes: 1, reservePercent: 10, maxRetries: 3, cooldownSeconds: 30, autoResume: false });
export const CONTINUATION_TEXT = 'Codex Control Center：实时额度查询已确认所有阻塞窗口可用。请在本聊天继续原有未完成工作；先核对当前进度、工作区和仍在运行的后台命令，接续尚未完成的步骤。保留原目标、模型、权限与预算；若已经完成或需要用户决定，请说明并停止。';
export function validateSettings(value) {
  const s = { ...DEFAULT_SETTINGS, ...value };
  if (![5,10,30,60].includes(s.recoveryPollSeconds) || !Number.isInteger(s.historySampleSeconds) || s.historySampleSeconds < 60 || !Number.isInteger(s.maxConcurrentResumes) || s.maxConcurrentResumes < 1 || s.maxConcurrentResumes > 20 || !Number.isFinite(s.reservePercent) || s.reservePercent < 0 || s.reservePercent >= 100 || !Number.isInteger(s.maxRetries) || s.maxRetries < 1 || s.maxRetries > 100 || !Number.isFinite(s.cooldownSeconds) || s.cooldownSeconds < 0 || typeof s.autoResume !== 'boolean') throw new Error('invalid-core-settings');
  return s;
}
const defaults = s => ({ autoResume: true, allowAutomaticStart: true, neverAutoResume: false, manualPaused: false, priority: 2, order: 0, maxRetries: s.maxRetries, cooldownSeconds: s.cooldownSeconds, retryCount: 0, nextAttemptAt: 0 });

export class ControlCenterCore {
  constructor({ adapter, store, settings = {}, now = Date.now, execute = false }) {
    Object.assign(this, { adapter, store, now, execute });
    this.settings = validateSettings(store.getSetting('core-settings', settings));
    store.setSetting('core-settings',this.settings);
    this.nextQuotaPollAt = 0; this.nextScanAt = 0; this.polling = null; this.nextHistorySampleAt = store.getSetting('next-history-sample-at', 0); this.nextCompatibilityAt = 0;
    this.quota = null; this.lastQuotaPollAt = null; this.lastError = null; this.errorCount = 0; this.active = new Set();this.manualResumes=new Set(); this.stopped = false; this.ticking = false;
    const desktop = { snapshot: id => adapter.snapshot(id),
      request: (method, params, owner) => { this.assertThreadEnabled(params.conversationId); return adapter.desktop.request(method, params, owner); } };
    if (typeof adapter.desktop.getGeneration === 'function') desktop.getGeneration = id => adapter.desktop.getGeneration(id);
    this.engine = new WatchdogEngine({ store, desktop, account: adapter.account, now, execute, quotaProbeMode: 'live', resetBufferMs: 0, continuationText: CONTINUATION_TEXT,
      enabled: id => !this.stopped && adapter.compatibility.verified && (this.manualResumes.has(id)||(this.settings.autoResume&&(!id||this.threadEnabled(id)))),
      enrollmentSince: () => this.enrollmentSince,
      verifyDesktop: () => adapter.verifyWriteSafety(), log: (event, details) => store.event(event, details) });
    // Never silently enroll work that stopped before this application was enabled.
    this.enrollmentSince = this.settings.autoResume ? store.getSetting('enrollment-since', now()) : now();
    if (this.settings.autoResume) store.setSetting('enrollment-since', this.enrollmentSince);
  }
  setSettings(update) {
    const next = validateSettings({ ...this.settings, ...update });
    if (!this.settings.autoResume && next.autoResume) { this.enrollmentSince = this.now(); this.store.setSetting('enrollment-since', this.enrollmentSince); }
    this.settings = next; this.store.setSetting('core-settings', next); this.nextQuotaPollAt = Math.min(this.nextQuotaPollAt, this.now()); return this.snapshot();
  }
  policy(id) { return { ...defaults(this.settings), ...this.store.getThreadPolicy(id) }; }
  threadEnabled(id) { const p=this.policy(id); return p.autoResume && p.allowAutomaticStart && !p.manualPaused && !p.neverAutoResume; }
  assertThreadEnabled(id) {
    const p = this.policy(id);
    if(this.manualResumes.has(id)&&!this.stopped)return;
    if (!this.settings.autoResume || p.manualPaused || p.neverAutoResume || !p.autoResume || !p.allowAutomaticStart || this.stopped) throw new Error('thread-auto-resume-disabled');
  }
  setThreadPolicy(id, update) {
    if (!isUuid(id)) throw new Error('invalid-thread-id');
    const allowed = ['autoResume','allowAutomaticStart','neverAutoResume','manualPaused','priority','order','maxRetries','cooldownSeconds'];
    if (Object.keys(update).some(k => !allowed.includes(k))) throw new Error('unknown-thread-policy-field');
    const policy = { ...this.policy(id), ...update };
    if (['autoResume','allowAutomaticStart','neverAutoResume','manualPaused'].some(k => typeof policy[k] !== 'boolean') || !Number.isInteger(policy.priority) || policy.priority < 0 || policy.priority > 3 || !Number.isInteger(policy.order) || !Number.isInteger(policy.maxRetries) || policy.maxRetries < 1 || !Number.isFinite(policy.cooldownSeconds) || policy.cooldownSeconds < 0) throw new Error('invalid-thread-policy');
    this.store.setThreadPolicy(id, policy); this.store.event('thread-policy-updated', { threadId: id, changed: Object.keys(update) }); return policy;
  }
  async pollQuota() {
    if (this.polling) return this.polling;
    if (this.stopped || this.now() < this.nextQuotaPollAt) return this.quota;
    this.polling = (async () => {
      try {
        await this.adapter.connect();
        const raw = await this.adapter.readQuota(); this.lastQuotaPollAt = this.now(); this.quota = quotaStatus(raw,this.now());
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
          const { state } = await this.adapter.snapshot(id); const decision = assess(state, { catalogPersistent: true });
          const turn=latestTurn(state);
          const outstanding=Object.values(this.engine.state.ledger).filter(i=>i.threadId===id&&(['sent','uncertain','dispatching'].includes(i.phase)||i.lifecycle==='running'));
          for(const intent of outstanding)if(turn && turn.turnId!==intent.failureTurnId){intent.phase='confirmed';intent.confirmedTurnId=turn.turnId;intent.lifecycle=['completed','failed','interrupted'].includes(turn.status)?'finished':'running';}
          // A transport ACK may precede the desktop's read-after-write snapshot.
          // Keep that resume's slot and never reinterpret the old failed turn as a new incident.
          const acknowledgedLag=outstanding.some(i=>i.phase==='sent'&&turn?.turnId===i.failureTurnId);
          if(!acknowledgedLag)this.engine.observe(id, state, this.quota);
          const record = this.engine.state.records[id];
          if(record) {
            record.title=typeof state.title==='string'?state.title:null;
            record.workspace=typeof state.cwd==='string'?state.cwd:null;
            record.modelId=state.latestModel??null;record.reasoningEffort=state.latestReasoningEffort??null;
            record.serviceTier=state.latestThreadSettings?.serviceTier??null;record.lastActivityAt=this.now();
            delete record.unavailableReason;
          }
          if (record && decision.action === 'wait' && ['approval-or-input-pending','user-message-pending','goal-user-confirmation'].includes(decision.reason)) { this.engine.transition(record,'needsUser',decision.reason); }
        } catch (error) {
          if (!['no-client-found','desktop-snapshot-timeout','desktop-read-compatibility-unverified'].includes(error.message)) throw error;
          const record = this.engine.state.records[id];
          if (record) {
            record.unavailableReason = error.message;
            if(this.execute && this.settings.autoResume && this.threadEnabled(id) && this.quota?.ready && record.failureTurnId && record.phase==='waitingQuota' && this.now()>=(record.lastOpenAttemptAt??0)+120000 && typeof this.adapter.reopen==='function') {
              let canOpen=true;
              if(record.kind==='goal'){const {goal}=await this.adapter.account.request('thread/goal/get',{threadId:id});canOpen=goal?.status==='usageLimited'&&goalIdentity(goal)===record.goalIdentity;}
              if(canOpen){record.lastOpenAttemptAt=this.now();this.adapter.reopen(id);this.store.event('opening-pending-chat',{threadId:id});}
            }
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
      .filter(({r,p}) => p.autoResume && p.allowAutomaticStart && !p.neverAutoResume && !p.manualPaused && p.retryCount < p.maxRetries && p.nextAttemptAt <= this.now() && (p.priority < 2 || this.quota.fiveHourRemainingPercent > this.settings.reservePercent))
      .sort((a,b) => a.p.priority-b.p.priority || a.r.failedAt-b.r.failedAt || a.p.order-b.p.order);
    // Occupancy includes already resumed work; avoid releasing a slot merely on receipt of a start acknowledgement.
    const available = Math.max(0,this.settings.maxConcurrentResumes-this.occupiedThreads().size);
    await Promise.all(queue.slice(0,available).map(({r,p}) => this.dispatch(r,p)));
  }
  async dispatch(record, policy) {
    if (this.active.has(record.threadId) || this.stopped || (!this.settings.autoResume&&!this.manualResumes.has(record.threadId))) return false;
    this.active.add(record.threadId);
    try {
      this.assertThreadEnabled(record.threadId);
      if(!await this.adapter.isEligible(record.threadId)){this.engine.transition(record,'inactive','archived-or-no-longer-root');delete record.failureTurnId;this.engine.save();return false;}
      this.adapter.verifyWriteSafety();
      const ok = await this.engine.recover(record.threadId);
      if (ok) { policy.retryCount = 0; policy.nextAttemptAt = 0; this.store.event('auto-resumed',{ threadId:record.threadId }); }
      else if (record.phase === 'needsAttention') { policy.retryCount++; policy.autoResume = false; this.store.event('resume-needs-attention',{ threadId:record.threadId, reason:record.reason }); }
      else if (record.phase === 'waitingQuota' && record.reason === 'desktop-state-changed-before-send') { policy.retryCount++; policy.nextAttemptAt = this.now()+policy.cooldownSeconds*1000; }
      if (policy.retryCount >= policy.maxRetries) { policy.autoResume = false; this.engine.transition(record,'needsAttention','retry-limit-reached'); }
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
    return { mode: this.execute ? 'execute' : 'observe', settings: this.settings, compatibility: this.adapter.compatibility, quota: this.quota,
      lastQuotaPollAt: this.lastQuotaPollAt, nextQuotaPollAt: this.nextQuotaPollAt, nextHistorySampleAt: this.nextHistorySampleAt, lastError: this.lastError,
      tasks: Object.values(this.engine.state.records).map(r => ({ ...r, policy: this.policy(r.threadId) })), activeResumes: this.active.size };
  }
  occupiedThreads() {
    const occupied=new Set(Object.values(this.engine.state.records).filter(r=>r.phase==='watching'&&['running','continuation-accepted','new-turn-observed','goal-between-turns'].includes(r.reason)).map(r=>r.threadId));
    for(const intent of Object.values(this.engine.state.ledger))if(['sent','uncertain','dispatching'].includes(intent.phase)||intent.lifecycle==='running')occupied.add(intent.threadId);
    for(const id of this.active)occupied.add(id);
    for(const id of this.manualResumes)occupied.add(id);
    return occupied;
  }
  async resumeNow(id) {
    if(!isUuid(id))throw new Error('invalid-thread-id');
    if(!this.execute)throw new Error('observe-mode-cannot-resume');
    const record=this.engine.state.records[id];
    if(!record?.failureTurnId||record.phase!=='waitingQuota')throw new Error('thread-not-eligible-for-quota-resume');
    if(this.active.has(id)||this.manualResumes.has(id))throw new Error('resume-already-in-flight');
    if(this.occupiedThreads().size>=this.settings.maxConcurrentResumes)throw new Error('resume-concurrency-limit');
    this.manualResumes.add(id);
    try{const quota=quotaStatus(await this.adapter.readQuota(),this.now());if(!quota.known||!quota.ready)throw new Error(quota.reason);return{resumed:await this.dispatch(record,this.policy(id))};}finally{this.manualResumes.delete(id);}
  }
  async close() { this.stopped = true; if(this.polling) await this.polling; await this.adapter.close(); }
}
