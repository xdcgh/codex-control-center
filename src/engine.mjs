import { randomUUID } from 'node:crypto';
import { assess, quotaStatus, goalIdentity, settingsFingerprint, latestTurn, isUuid, CONTINUATION } from './policy.mjs';

export class WatchdogEngine {
  constructor({ store, desktop, account, now = Date.now, enabled, execute = false, resetBufferMs = 120000, log = () => {}, state, enrollmentSince, verifyDesktop = () => {} }) {
    Object.assign(this, { store, desktop, account, now, enabled, execute, resetBufferMs, log, enrollmentSince, verifyDesktop });
    this.state = state ?? store.load();
    this.state.startedAt ??= new Date(now()).toISOString();
  }
  save() { this.store.save(this.state); }
  transition(record, phase, reason) {
    if (record.phase !== phase || record.reason !== reason) {
      record.phase = phase; record.reason = reason;
      this.log('task-state', { threadId: record.threadId, phase, reason });
    }
  }
  observe(threadId, snapshot, quota) {
    if (snapshot.id !== threadId) throw new Error('snapshot-id-mismatch');
    const decision = assess(snapshot, { catalogPersistent: true });
    let record = this.state.records[threadId];
    if (decision.action === 'running') {
      record ??= this.state.records[threadId] = { threadId, seenActiveAt: this.now(), phase: 'watching' };
      // New running work clears the old wait, including a manual/App recovery.
      if (record.failureTurnId && decision.turnId !== record.failureTurnId) {
        const key = `${threadId}:${record.failureTurnId}`;
        const ledger = this.state.ledger[key];
        if (ledger) { ledger.phase = 'confirmed'; ledger.confirmedTurnId = decision.turnId; }
        delete record.failureTurnId; delete record.attemptKey; delete record.notBeforeMs;
        this.log('recovery-observed', { threadId, turnId: decision.turnId });
      }
      record.lastTurnId = decision.turnId;
      record.kind = snapshot.threadGoal ? 'goal' : 'ordinary';
      record.observedGoalIdentity = goalIdentity(snapshot.threadGoal);
      record.observedGoalCreatedAt = snapshot.threadGoal?.createdAt ?? null;
      record.seenActiveAt = this.now();
      if (quota?.known && Number.isFinite(quota.resetsAtMs)) record.lastQuotaResetMs = quota.resetsAtMs;
      this.transition(record, 'watching', 'running');
      return decision;
    }
    // A short newly submitted task may hit quota between polls. Its trusted turn
    // start/Goal update proves it was active during this enabled enrollment.
    const since = this.enrollmentSince?.() ?? Date.parse(this.state.startedAt);
    const turn = latestTurn(snapshot);
    const duringEnrollment = (time) => Number.isFinite(time) && time >= since && time <= this.now() + 300000;
    const newQuotaActivity = decision.action === 'quotaFailure' && (duringEnrollment(turn?.turnStartedAtMs) || (decision.goalStatus === 'usageLimited' && duringEnrollment(snapshot.threadGoal?.updatedAt * 1000)));
    if (!record && newQuotaActivity) record = this.state.records[threadId] = { threadId, seenActiveAt: this.now(), phase: 'watching', lastQuotaResetMs: this.state.lastQuotaResetMs };
    if (!record) return decision;
    if (record.phase === 'inactive' && newQuotaActivity && (decision.turnId !== record.lastTurnId || (decision.goalIdentity != null && snapshot.threadGoal?.createdAt !== record.observedGoalCreatedAt))) this.transition(record, 'watching', 'new-work-during-enrollment');
    if (decision.action === 'skip') {
      this.transition(record, 'inactive', decision.reason);
      delete record.failureTurnId; delete record.notBeforeMs;
      return decision;
    }
    if (decision.action !== 'quotaFailure') {
      if (!['dispatching', 'needsAttention'].includes(record.phase)) this.transition(record, record.failureTurnId ? 'waitingQuota' : 'watching', decision.reason);
      return decision;
    }
    if (record.phase === 'inactive') return decision;
    if (record.failureTurnId !== decision.turnId) {
      const key = `${threadId}:${decision.turnId}`;
      record.failureTurnId = decision.turnId;
      record.lastTurnId = decision.turnId;
      record.attemptKey = key;
      record.settings = decision.settings;
      record.goalIdentity = decision.goalIdentity;
      record.observedGoalIdentity = decision.goalIdentity;
      record.observedGoalCreatedAt = snapshot.threadGoal?.createdAt ?? null;
      record.goalStatus = decision.goalStatus;
      record.kind = decision.goalIdentity ? 'goal' : 'ordinary';
      record.failedAt = this.now();
      delete record.notBeforeMs;
      if (this.state.ledger[key]) {
        this.transition(record, 'needsAttention', 'existing-delivery-intent');
      } else {
        this.transition(record, 'waitingQuota', 'usage-limit-exceeded');
      }
    }
    if (record.phase === 'needsAttention') return decision;
    if (quota?.known && record.notBeforeMs == null) {
      const reset = quota.ready && Number.isFinite(record.lastQuotaResetMs) ? record.lastQuotaResetMs : quota.resetsAtMs;
      record.notBeforeMs = Number.isFinite(reset) ? reset + this.resetBufferMs : this.now() + this.resetBufferMs;
    }
    if (quota?.known && !quota.ready && record.notBeforeMs <= this.now() && quota.resetsAtMs > this.now()) record.notBeforeMs = quota.resetsAtMs + this.resetBufferMs;
    return decision;
  }
  assertFresh(record, state, { goalRestored = false } = {}) {
    const current = assess(state, { catalogPersistent: true });
    if (current.action !== 'quotaFailure' || current.turnId !== record.failureTurnId || current.settings !== record.settings || current.goalIdentity !== record.goalIdentity) throw new Error('task-changed-before-resume');
    if (current.goalStatus !== record.goalStatus && !(goalRestored && record.goalStatus === 'usageLimited' && current.goalStatus === 'active')) throw new Error('goal-status-changed-before-resume');
    return current;
  }
  async recover(threadId) {
    const record = this.state.records[threadId];
    if (!record?.failureTurnId || record.phase === 'inactive' || record.phase === 'needsAttention' || record.notBeforeMs == null || this.now() < record.notBeforeMs || !this.enabled()) return false;
    const quota = quotaStatus(await this.account.request('account/rateLimits/read'), this.now());
    if (!quota.known || !quota.ready) {
      if (quota.known && quota.resetsAtMs > this.now()) record.notBeforeMs = Math.max(record.notBeforeMs, quota.resetsAtMs + this.resetBufferMs);
      this.transition(record, 'waitingQuota', quota.reason);
      this.save(); return false;
    }
    const first = await this.desktop.snapshot(threadId);
    const key = record.attemptKey;
    let intent = this.state.ledger[key];
    if (intent && ['dispatching', 'uncertain', 'sent', 'confirmed'].includes(intent.phase)) {
      if (this.confirmFromSnapshot(record, first.state)) return true;
      this.transition(record, 'needsAttention', 'delivery-unconfirmed-no-retry'); this.save(); return false;
    }
    try { this.assertFresh(record, first.state, { goalRestored: intent?.phase === 'goalRestored' || intent?.phase === 'goalRestoring' }); }
    catch (error) { this.transition(record, 'inactive', error.message); this.save(); return false; }
    if (!this.execute) { this.transition(record, 'waitingQuota', 'observe-mode-would-resume'); this.save(); return false; }
    this.verifyDesktop();
    if (!this.enabled()) return false;
    intent ??= this.state.ledger[key] = { threadId, failureTurnId: record.failureTurnId, messageId: randomUUID(), createdAt: this.now(), phase: 'prepared' };
    try {
      if (record.goalStatus === 'usageLimited') {
        const before = (await this.account.request('thread/goal/get', { threadId })).goal;
        if (goalIdentity(before) !== record.goalIdentity) throw new Error('goal-identity-changed');
        const alreadyRestored = ['goalRestoring', 'goalRestored'].includes(intent.phase);
        if (before?.status !== 'usageLimited' && !(alreadyRestored && before?.status === 'active')) throw new Error('goal-status-changed');
        if (before.tokenBudget != null && before.tokensUsed >= before.tokenBudget) throw new Error('goal-budget-exhausted');
        if (before.status === 'usageLimited') {
          intent.phase = 'goalRestoring'; this.save();
          if (!this.enabled()) return false;
          const restored = (await this.account.request('thread/goal/set', { threadId, status: 'active' })).goal;
          if (restored.status !== 'active' || goalIdentity(restored) !== record.goalIdentity || restored.tokensUsed !== before.tokensUsed) throw new Error('goal-restore-verification-failed');
        }
        intent.phase = 'goalRestored'; this.save();
      }
      // Fetch another complete snapshot after Goal restoration and immediately before dispatch.
      const fresh = await this.desktop.snapshot(threadId);
      if (this.confirmFromSnapshot(record, fresh.state)) return true;
      this.assertFresh(record, fresh.state, { goalRestored: record.goalStatus === 'usageLimited' });
      if (first.owner !== fresh.owner) throw new Error('desktop-owner-changed');
      const finalQuota = quotaStatus(await this.account.request('account/rateLimits/read'), this.now());
      if (!finalQuota.known || !finalQuota.ready || !this.enabled()) {
        this.transition(record, 'waitingQuota', finalQuota.reason); this.save(); return false;
      }
      this.verifyDesktop();
      await new Promise((resolve) => setImmediate(resolve));
      if (typeof this.desktop.getGeneration === 'function' && this.desktop.getGeneration(threadId) !== fresh.generation) throw new Error('desktop-state-changed');
      // Persist intent before one and only one write. A lost acknowledgement never causes replay.
      intent.phase = 'dispatching'; intent.sentAt = this.now();
      this.transition(record, 'dispatching', 'sending-continuation'); this.save();
      if (!this.enabled()) { intent.phase = record.goalStatus === 'usageLimited' ? 'goalRestored' : 'prepared'; this.save(); return false; }
      const response = await this.desktop.request('thread-follower-start-turn', {
        conversationId: threadId,
        turnStart: { request: { threadId, clientUserMessageId: intent.messageId,
          input: [{ type: 'text', text: CONTINUATION, text_elements: [] }] },
          context: { inheritThreadSettings: true } },
      }, fresh.owner);
      const turnId = response.result?.result?.turn?.id;
      if (!isUuid(turnId) || response.handledByClientId !== fresh.owner) throw new Error('delivery-uncertain');
      intent.phase = 'sent'; intent.confirmedTurnId = turnId;
      this.transition(record, 'watching', 'continuation-accepted');
      record.lastTurnId = turnId;
      delete record.failureTurnId; delete record.notBeforeMs;
      this.log('continuation-accepted', { threadId, turnId, goalRestored: record.goalStatus === 'usageLimited' });
      this.save(); return true;
    } catch (error) {
      if (error.message === 'desktop-state-changed' && intent.phase !== 'dispatching') {
        this.transition(record, 'waitingQuota', 'desktop-state-changed-before-send'); this.save(); return false;
      }
      if (intent.phase === 'dispatching') intent.phase = 'uncertain';
      this.transition(record, 'needsAttention', error.message);
      this.save(); return false;
    }
  }
  confirmFromSnapshot(record, snapshot) {
    const intent = this.state.ledger[record.attemptKey];
    const turn = latestTurn(snapshot);
    if (!turn || turn.turnId === record.failureTurnId) return false;
    // A new native turn, including manual recovery, ends this old quota incident.
    if (intent) { intent.phase = 'confirmed'; intent.confirmedTurnId = turn.turnId; }
    delete record.failureTurnId; delete record.notBeforeMs;
    this.transition(record, 'watching', 'new-turn-observed'); this.save(); return true;
  }
}
