import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountClient } from '../src/rpc.mjs';
import { OfficialAppServerAdapter, CodexAdapter } from '../src/adapters/codex.mjs';
import { ACCOUNT_USAGE_SOURCE, normalizeAccountUsage, unavailableAccountUsage, validateAccountUsageParams } from '../src/observability/account-usage.mjs';

const threadId = '11111111-1111-4111-8111-111111111111';
const otherThreadId = '22222222-2222-4222-8222-222222222222';
const fetchedAt = 1790000000000;
const summary = { lifetimeTokens: 123, peakDailyTokens: 23, longestRunningTurnSec: 45, currentStreakDays: 2, longestStreakDays: 4 };
const account = () => ({ summary: { ...summary }, dailyUsageBuckets: [{ startDate: '2026-10-10', tokens: 23 }], threadUsage: null });
const group = () => ({ model: 'vendor/model', reasoningEffort: 'high', speed: 'priority', inputTokens: 10, netNewInputTokens: 8, cachedInputTokens: 2, outputTokens: 5, totalTokens: 200, estimatedUsageCreditsMicros: 100 });
const usage = () => ({ threadId, estimatedUsageCreditsMicros: 100, estimatedUsageUsdMicros: 50, groups: [group()] });

test('account snapshot projects only official summary/daily fields and keeps ledger and billing boundaries explicit', () => {
  const raw = account(); raw.privateAccountId = 'private-secret'; raw.summary.email = 'private@example.invalid'; raw.dailyUsageBuckets[0].prompt = 'private-prompt';
  const value = normalizeAccountUsage(raw, { fetchedAt });
  assert.equal(value.source, ACCOUNT_USAGE_SOURCE);
  assert.equal(value.fetchedAt, fetchedAt);
  assert.equal(value.status, 'Observed');
  assert.deepEqual(value.summary, summary);
  assert.deepEqual(value.dailyBuckets, [{ startDate: '2026-10-10', tokens: 23 }]);
  assert.equal(value.threadUsage.status, 'Unavailable');
  assert.equal(value.threadUsage.reason, 'thread-usage-not-requested');
  assert.equal(value.quality.canCombineWithLocalLedgers, false);
  assert.match(value.quality.billingMeaning, /not a Codex subscription bill/);
  assert.doesNotMatch(JSON.stringify(value), /private-secret|private@example|private-prompt/);
});

test('missing, negative, unsafe and nonnumeric metrics stay null rather than becoming zero', () => {
  const value = normalizeAccountUsage({ summary: { lifetimeTokens: null, peakDailyTokens: Number.MAX_SAFE_INTEGER + 1, longestRunningTurnSec: -1, currentStreakDays: '2', longestStreakDays: 0 }, dailyUsageBuckets: null }, { fetchedAt });
  assert.deepEqual(value.summary, { lifetimeTokens: null, peakDailyTokens: null, longestRunningTurnSec: null, currentStreakDays: null, longestStreakDays: 0 });
  assert.equal(value.dailyBuckets, null);
  assert.equal(value.status, 'Partial');
  assert.equal(value.quality.missing['summary.lifetimeTokens'], 'field-not-exposed');
  assert.equal(value.quality.missing['summary.peakDailyTokens'], 'invalid-nonnegative-safe-integer');
  assert.equal(normalizeAccountUsage({ summary: {}, dailyUsageBuckets: null }, { fetchedAt }).status, 'Unavailable');
});

test('daily dates and duplicate rows are checked without summing ambiguous activity', () => {
  const value = normalizeAccountUsage({ summary, dailyUsageBuckets: [{ startDate: '2024-02-29', tokens: 0 }, { startDate: '2026-02-29', tokens: 2 }, { startDate: '2026-10-10', tokens: -1 }, { startDate: '2024-02-29', tokens: 99 }, { startDate: '2026-10-11T00:00:00Z', tokens: 3 }] }, { fetchedAt });
  assert.deepEqual(value.dailyBuckets, [{ startDate: '2024-02-29', tokens: 0 }, { startDate: '2026-10-10', tokens: null }]);
  assert.equal(value.quality.missing['dailyBuckets[1].startDate'], 'invalid-date');
  assert.equal(value.quality.missing['dailyBuckets[3]'], 'duplicate-date-not-combined');
  assert.equal(value.status, 'Partial');
});

test('matched thread estimates retain reported totals and raw speed without claiming tier or cache-write counts', () => {
  const value = normalizeAccountUsage({ ...account(), threadUsage: usage() }, { params: { threadId }, fetchedAt });
  assert.equal(value.threadUsage.status, 'Estimated');
  assert.equal(value.threadUsage.identityMatched, true);
  assert.deepEqual(value.threadUsage.estimates, { status: 'Estimated', creditsMicros: 100, usdMicros: 50 });
  const row = value.threadUsage.groups[0];
  assert.equal(row.totalTokens, 200);
  assert.equal(row.rawSpeed, 'priority');
  assert.equal(row.estimateStatus, 'Estimated');
  assert.equal(Object.hasOwn(row, 'serviceTier'), false);
  assert.equal(Object.hasOwn(row, 'cacheWriteTokens'), false);
  assert.match(value.quality.tokenDefinition, /no inferred total/);
  assert.doesNotMatch(JSON.stringify(value), new RegExp(threadId));
});

test('unrequested, missing and mismatched thread data never expose IDs or private group data', () => {
  const privateUsage = { ...usage(), threadId: otherThreadId, groups: [{ model: 'private-model-sentinel' }] };
  const unrequested = normalizeAccountUsage({ ...account(), threadUsage: privateUsage }, { fetchedAt });
  const mismatch = normalizeAccountUsage({ ...account(), threadUsage: privateUsage }, { params: { threadId }, fetchedAt });
  const unavailable = normalizeAccountUsage(account(), { params: { threadId }, fetchedAt });
  assert.equal(unrequested.threadUsage.reason, 'thread-usage-not-requested');
  assert.equal(mismatch.threadUsage.reason, 'thread-usage-identity-mismatch');
  assert.equal(mismatch.threadUsage.identityMatched, false);
  assert.equal(unavailable.threadUsage.reason, 'thread-usage-not-exposed');
  assert.equal(unavailable.threadUsage.status, 'Unavailable');
  for (const value of [unrequested, mismatch, unavailable]) {
    assert.deepEqual(value.threadUsage.groups, []);
    assert.doesNotMatch(JSON.stringify(value), /private-model-sentinel|11111111-1111|22222222-2222/);
  }
});

test('partial thread categories and service estimates stay explicit with unknown model/speed identifiers unchanged', () => {
  const value = normalizeAccountUsage({ ...account(), threadUsage: { ...usage(), estimatedUsageUsdMicros: null, groups: [{ ...group(), model: 'new/vendor-model', speed: 'future-speed', cachedInputTokens: null, totalTokens: null }] } }, { params: { threadId }, fetchedAt });
  assert.equal(value.threadUsage.status, 'Partial');
  assert.equal(value.threadUsage.estimates.status, 'Estimated');
  assert.equal(value.threadUsage.estimates.usdMicros, null);
  assert.equal(value.threadUsage.groups[0].rawSpeed, 'future-speed');
  assert.equal(value.threadUsage.groups[0].model, 'new/vendor-model');
  assert.equal(value.threadUsage.groups[0].totalTokens, null);
  assert.equal(value.quality.missing['threadUsage.groups[0].cachedInputTokens'], 'field-not-exposed');
});

test('RPC usage params are a strict read-only projection and do not evaluate accessors', async () => {
  const client = new AccountClient({}); const sent = [];
  client.raw = async (method, params) => { sent.push({ method, params }); return {}; };
  for (const params of [undefined, null, {}, { threadId: null }, { threadId }]) await client.request('account/usage/read', params);
  assert.deepEqual(sent.map(item => item.params), [{}, {}, {}, {}, { threadId }]);
  let getterCalled = false;
  const accessor = Object.defineProperty({}, 'threadId', { get() { getterCalled = true; return threadId; } });
  for (const params of [[], 'bad', { threadId: 'not-a-uuid' }, { threadId, status: 'active' }, { refreshToken: true }, accessor, Object.create({ threadId })]) assert.throws(() => client.request('account/usage/read', params), /invalid-account-usage/);
  assert.equal(getterCalled, false);
  assert.equal(sent.length, 5);
  assert.deepEqual(validateAccountUsageParams(Object.assign(Object.create(null), { threadId })), { threadId });
});

test('new read method does not widen mutation allowlist or the original exact Goal restoration guard', async () => {
  const client = new AccountClient({}); const sent = [];
  client.raw = async (method, params) => { sent.push({ method, params }); return {}; };
  for (const method of ['account/rateLimitResetCredit/consume', 'account/sendAddCreditsNudgeEmail', 'account/login/start', 'account/logout', 'thread/start', 'turn/start']) assert.throws(() => client.request(method, {}), /account-method-not-allowed/);
  for (const params of [{ threadId, status: 'paused' }, { threadId, status: 'active', tokenBudget: 1 }, { threadId, status: 'active', objective: 'changed' }]) assert.throws(() => client.request('thread/goal/set', params), /goal-update-not-allowed/);
  await client.request('thread/goal/set', { threadId, status: 'active' });
  assert.deepEqual(sent, [{ method: 'thread/goal/set', params: { threadId, status: 'active' } }]);
});

test('adapter returns bounded unavailable reasons for timeout/unknown method and keeps private RPC errors out of snapshots', async () => {
  const adapter = new OfficialAppServerAdapter({});
  for (const [message, expected] of [['account-query-timeout', 'account-usage-timeout'], ['account-rpc--32601', 'account-usage-method-unavailable'], ['private account token error', 'account-usage-request-failed']]) {
    adapter.request = async () => { throw new Error(message); };
    const value = await adapter.readAccountUsage();
    assert.equal(value.status, 'Unavailable'); assert.equal(value.reason, expected);
    assert.doesNotMatch(JSON.stringify(value), /private account token/);
  }
  adapter.request = async (method, params) => { assert.equal(method, 'account/usage/read'); assert.deepEqual(params, {}); return account(); };
  assert.equal((await adapter.readAccountUsage()).status, 'Observed');
  await assert.rejects(adapter.readAccountUsage({ status: 'active' }), /invalid-account-usage-params/);
  const facade = new CodexAdapter({}); facade.official = adapter;
  assert.equal((await facade.readAccountUsage()).source, ACCOUNT_USAGE_SOURCE);
  assert.equal(unavailableAccountUsage('private-sentinel').reason, 'account-usage-unavailable');
});

test('account RPC response limit remains eight MiB and closes only its own fixture child', () => {
  const client = new AccountClient({}); let killed = false;
  client.child = { kill() { killed = true; } };
  client.read(Buffer.alloc(8 * 1024 * 1024 + 1, 0x61));
  assert.equal(killed, true);
  assert.equal(client.pending.size, 0);
});
