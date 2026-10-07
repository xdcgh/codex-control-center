import { createHash } from 'node:crypto';

export const CONTINUATION = 'Codex Quota Watchdog：额度已按服务返回的重置时间恢复，并额外等待了 2 分钟。请在本聊天继续原有未完成工作；先核对当前进度、工作区和仍在运行的后台命令，接续尚未完成的步骤。保留原目标、模型、权限与预算；若已经完成或需要用户决定，请说明并停止。';
export const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const isUuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function latestTurn(state) {
  if (state.turnHistory?.kind === 'canonical') {
    const history = state.turnHistory.history;
    const tail = history?.islands?.at(-1);
    if (tail?.newerBoundary?.status !== 'exhausted' || !tail.entries?.length) return null;
    const entry = tail.entries.at(-1);
    const turn = history.entitiesByKey?.[entry.value];
    return turn && typeof turn === 'object' ? turn : null;
  }
  return Array.isArray(state.turns) ? state.turns.at(-1) ?? null : null;
}

export function goalIdentity(goal) {
  if (!goal) return null;
  return digest({ objective: goal.objective, createdAt: goal.createdAt, tokenBudget: goal.tokenBudget ?? null });
}

export function settingsFingerprint(state) {
  return digest({ hostId: state.hostId, cwd: state.cwd, latestModel: state.latestModel,
    latestReasoningEffort: state.latestReasoningEffort, latestCollaborationMode: state.latestCollaborationMode,
    currentPermissions: state.currentPermissions, latestThreadSettings: state.latestThreadSettings,
    source: state.source, threadSource: state.threadSource, goalIdentity: goalIdentity(state.threadGoal) });
}

export function assess(state, { catalogPersistent = false } = {}) {
  if (!state || !isUuid(state.id) || state.hostId !== 'local' || state.ephemeral === true || (state.ephemeral !== false && !catalogPersistent)) return { action: 'skip', reason: 'not-persistent-local-root' };
  const source = state.source;
  if (state.parentThreadId || state.sideConversation || (source && typeof source === 'object') || (typeof source === 'string' && source.includes('subagent')) || state.threadSource === 'agent') return { action: 'skip', reason: 'subagent-or-side-chat' };
  if (state.resumeState !== 'resumed') return { action: 'wait', reason: 'desktop-loading' };
  if (!Array.isArray(state.requests) || state.requests.length) return { action: 'wait', reason: 'approval-or-input-pending' };
  if ((state.queuedFollowUps?.length ?? 0) || (state.unconfirmedTurnSubmissions?.length ?? 0)) return { action: 'wait', reason: 'user-message-pending' };
  const goalStatus = state.threadGoal?.status;
  if (goalStatus && !['active', 'usageLimited'].includes(goalStatus)) return { action: 'skip', reason: `goal-${goalStatus}` };
  if (state.threadGoalResumeConfirmation && goalStatus !== 'usageLimited') return { action: 'skip', reason: 'goal-user-confirmation' };
  const runtime = state.threadRuntimeStatus;
  if (!runtime || typeof runtime !== 'object') return { action: 'wait', reason: 'runtime-unknown' };
  if ((runtime.activeFlags?.length ?? 0) > 0) return { action: 'wait', reason: 'runtime-waiting' };
  const turn = latestTurn(state);
  if (!turn || !isUuid(turn.turnId)) return { action: 'wait', reason: 'latest-turn-unavailable' };
  const info = turn.error?.codexErrorInfo;
  if (runtime.type === 'active' || turn.status === 'inProgress') return { action: 'running', turnId: turn.turnId };
  if (!['idle', 'systemError'].includes(runtime.type)) return { action: 'wait', reason: 'runtime-transition' };
  // An autonomous Goal may be parked by the shared quota gate before a new turn
  // is created; UsageLimited is itself a structured quota classification.
  const goalQuotaStop = goalStatus === 'usageLimited' && turn.status === 'completed';
  if (goalQuotaStop || (turn.status === 'failed' && ['usageLimitExceeded', 'UsageLimitExceeded'].includes(info))) return {
    action: 'quotaFailure', turnId: turn.turnId, settings: settingsFingerprint(state),
    goalIdentity: goalIdentity(state.threadGoal), goalStatus: goalStatus ?? null,
  };
  if (turn.status === 'interrupted') return { action: 'skip', reason: 'manually-interrupted', turnId: turn.turnId };
  if (turn.status === 'completed') return { action: goalStatus === 'active' ? 'wait' : 'skip', reason: goalStatus === 'active' ? 'goal-between-turns' : 'completed', turnId: turn.turnId };
  return { action: 'skip', reason: 'non-quota-error', turnId: turn.turnId };
}

export function quotaStatus(response, nowMs) {
  let bucket;
  if (response?.rateLimitsByLimitId) bucket = response.rateLimitsByLimitId.codex;
  else if (!response?.rateLimits?.limitId || response.rateLimits.limitId === 'codex') bucket = response?.rateLimits;
  if (!bucket) return { known: false, reason: 'codex-bucket-missing' };
  if (bucket.spendControlReached || bucket.individualLimit != null || (bucket.rateLimitReachedType != null && bucket.rateLimitReachedType !== 'rate_limit_reached')) return { known: false, reason: 'non-window-limit' };
  const windows = [bucket.primary, bucket.secondary].filter((window) => window != null);
  const valid = (window) => Number.isFinite(window.usedPercent) && window.usedPercent >= 0 && window.usedPercent <= 100 && (window.usedPercent === 0 ? (window.resetsAt == null || (Number.isFinite(window.resetsAt) && window.resetsAt > 0)) : (Number.isFinite(window.resetsAt) && window.resetsAt > 0)) && Number.isFinite(window.windowDurationMins) && window.windowDurationMins > 0;
  if (!windows.length || windows.some((window) => !valid(window))) return { known: false, reason: 'quota-fields-invalid' };
  const fiveHour = windows.find((window) => window.windowDurationMins === 300);
  if (!fiveHour) return { known: false, reason: 'five-hour-window-missing' };
  const exhausted = windows.filter((window) => window.usedPercent >= 100);
  const deadlines = [fiveHour.resetsAt, ...exhausted.map((window) => window.resetsAt)].filter((value) => Number.isFinite(value) && value > 0).map((value) => value * 1000);
  const resetsAtMs = deadlines.length ? Math.max(...deadlines) : null;
  // An empty newly reset window can retain its last deadline, or have no next
  // deadline until its first use. Non-empty expired snapshots are not trusted.
  const stale = windows.some((window) => window.usedPercent > 0 && window.resetsAt * 1000 <= nowMs);
  return { known: true, ready: !stale && exhausted.length === 0 && !bucket.rateLimitReachedType,
    resetsAtMs, fiveHourRemainingPercent: 100 - fiveHour.usedPercent,
    weeklyRemainingPercent: windows.find((window) => window.windowDurationMins === 10080) ? 100 - windows.find((window) => window.windowDurationMins === 10080).usedPercent : null,
    reason: stale ? 'quota-snapshot-stale' : exhausted.length ? 'quota-exhausted' : bucket.rateLimitReachedType ? 'service-still-limited' : 'quota-available' };
}
