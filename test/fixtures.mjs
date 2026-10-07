export const THREAD = '00000000-0000-4000-8000-000000000001';
export const TURN = '00000000-0000-4000-8000-000000000002';
export const NEXT = '00000000-0000-4000-8000-000000000003';
export const NOW = 1791302000000;
export function task({ status = 'failed', goalStatus, requests = [], overrides = {} } = {}) {
  const turn = { turnId: TURN, status, params: { clientUserMessageId: 'old-message' },
    error: status === 'failed' ? { codexErrorInfo: 'usageLimitExceeded', message: 'quota' } : null };
  return { id: THREAD, hostId: 'local', ephemeral: false, source: 'vscode', threadSource: 'user',
    cwd: 'C:/owned/project', latestModel: 'gpt-6.1-sol', latestReasoningEffort: 'high',
    latestCollaborationMode: { mode: 'default' }, currentPermissions: { approvalPolicy: 'on-request' },
    latestThreadSettings: { model: 'gpt-6.1-sol' }, resumeState: 'resumed', requests,
    threadRuntimeStatus: { type: status === 'inProgress' ? 'active' : 'systemError', activeFlags: [] },
    ...(goalStatus ? { threadGoal: { objective: 'Finish the owned work', status: goalStatus, createdAt: 111, tokenBudget: 9000, tokensUsed: 200 } } : {}),
    turnHistory: { kind: 'canonical', history: { entitiesByKey: { tail: turn }, islands: [{ entries: [{ key: 'tail', value: 'tail' }], newerBoundary: { status: 'exhausted' } }] } },
    ...overrides };
}
export function limits({ used = 100, weekly = 10, reset = NOW + 60000, weeklyReset = NOW + 86400000 } = {}) {
  return { rateLimitsByLimitId: { codex: { limitId: 'codex', primary: { usedPercent: used, windowDurationMins: 300, resetsAt: reset / 1000 }, secondary: { usedPercent: weekly, windowDurationMins: 10080, resetsAt: weeklyReset / 1000 }, rateLimitReachedType: null } } };
}
