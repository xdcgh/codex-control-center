import test from 'node:test';
import assert from 'node:assert/strict';
import { assess, quotaStatus } from '../src/policy.mjs';
import { task, limits, NOW } from './fixtures.mjs';

test('only a structured quota failure authorizes recovery', () => {
  assert.equal(assess(task()).action, 'quotaFailure');
  const fuzzy = task(); fuzzy.turnHistory.history.entitiesByKey.tail.error = { message: 'usage limit exceeded', codexErrorInfo: 'other' };
  assert.equal(assess(fuzzy).action, 'skip');
});
test('manual interruptions, completed tasks, approvals, side chats and budget stops stay stopped', () => {
  for (const status of ['completed', 'interrupted']) assert.equal(assess(task({ status })).action, 'skip');
  assert.equal(assess(task({ requests: [{ method: 'item/commandExecution/requestApproval' }] })).action, 'wait');
  assert.equal(assess(task({ overrides: { parentThreadId: 'parent' } })).action, 'skip');
  for (const goalStatus of ['paused', 'blocked', 'complete', 'budgetLimited']) assert.equal(assess(task({ goalStatus })).action, 'skip');
});
test('quota-limited Goal is eligible; legacy ephemeral omission requires catalog evidence', () => {
  assert.equal(assess(task({ goalStatus: 'usageLimited' })).action, 'quotaFailure');
  assert.equal(assess(task({ status: 'completed', goalStatus: 'usageLimited' })).action, 'quotaFailure');
  const legacy = task(); delete legacy.ephemeral;
  assert.equal(assess(legacy).action, 'skip');
  assert.equal(assess(legacy, { catalogPersistent: true }).action, 'quotaFailure');
});
test('a missing canonical tail never authorizes recovery', () => {
  const state = task(); state.turnHistory.history.islands[0].newerBoundary.status = 'partial';
  assert.equal(assess(state).action, 'wait');
});
test('five-hour AND weekly windows must be available, reset uses the later exhausted window', () => {
  const both = quotaStatus(limits({ weekly: 100 }), NOW);
  assert.equal(both.ready, false); assert.equal(both.resetsAtMs, NOW + 86400000);
  assert.equal(quotaStatus(limits({ used: 0 }), NOW).ready, true);
});
test('missing, malformed, stale and account-control quota data fail closed', () => {
  assert.equal(quotaStatus({}, NOW).known, false);
  const bad = limits(); bad.rateLimitsByLimitId.codex.primary.usedPercent = NaN;
  assert.equal(quotaStatus(bad, NOW).known, false);
  assert.equal(quotaStatus(limits({ used: 1, reset: NOW - 1 }), NOW).ready, false);
  const capped = limits(); capped.rateLimitsByLimitId.codex.individualLimit = {};
  assert.equal(quotaStatus(capped, NOW).known, false);
});
test('an empty reset window does not deadlock waiting for the next model request', () => {
  assert.equal(quotaStatus(limits({ used: 0, reset: NOW - 1000 }), NOW).ready, true);
  const empty = limits({ used: 0 }); empty.rateLimitsByLimitId.codex.primary.resetsAt = null;
  assert.equal(quotaStatus(empty, NOW).ready, true);
});
