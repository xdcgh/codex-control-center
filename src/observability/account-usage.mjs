import { isUuid } from '../policy.mjs';

// Account summary/daily fields: https://learn.chatgpt.com/docs/app-server#7-token-usage-chatgpt
// Optional thread fields follow the installed GetAccountTokenUsageResponse
// schema and remain independent service estimates, never a local-ledger total.
export const ACCOUNT_USAGE_SOURCE = 'official-app-server:account/usage/read';
export const ACCOUNT_SUMMARY_FIELDS = Object.freeze(['lifetimeTokens', 'peakDailyTokens', 'longestRunningTurnSec', 'currentStreakDays', 'longestStreakDays']);
const GROUP_NUMBERS = ['inputTokens', 'netNewInputTokens', 'cachedInputTokens', 'outputTokens', 'totalTokens', 'estimatedUsageCreditsMicros'];
const unavailableReasons = new Set(['account-usage-unavailable', 'account-usage-method-unavailable', 'account-usage-timeout', 'account-usage-request-failed', 'account-usage-schema-invalid']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const label = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !value.startsWith('0000-') && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

// The installed schema permits only an optional Thread ID. Canonicalization
// drops null/undefined and never forwards unknown properties or accessors.
export function validateAccountUsageParams(params) {
  if (params == null) return {};
  if (!object(params) || ![Object.prototype, null].includes(Object.getPrototypeOf(params))) throw new Error('invalid-account-usage-params');
  if (Reflect.ownKeys(params).some(key => key !== 'threadId')) throw new Error('invalid-account-usage-params');
  const property = Object.getOwnPropertyDescriptor(params, 'threadId');
  if (property && !Object.hasOwn(property, 'value')) throw new Error('invalid-account-usage-params');
  const id = property?.value;
  if (id == null) return {};
  if (!isUuid(id)) throw new Error('invalid-account-usage-thread-id');
  return { threadId: id };
}

function emptyThread(reason, identityMatched = null) {
  return { status: 'Unavailable', reason, identityMatched, estimates: { status: 'Unavailable', creditsMicros: null, usdMicros: null }, groups: [] };
}
function envelope(params, fetchedAt) {
  return { schemaVersion: 1, source: ACCOUNT_USAGE_SOURCE, fetchedAt: integer(fetchedAt), requestedScope: params.threadId ? 'thread' : 'account', status: 'Unavailable', reason: null,
    summary: Object.fromEntries(ACCOUNT_SUMMARY_FIELDS.map(key => [key, null])), dailyBuckets: null,
    threadUsage: emptyThread(params.threadId ? 'thread-usage-not-exposed' : 'thread-usage-not-requested'),
    quality: { missing: {}, canCombineWithLocalLedgers: false, tokenDefinition: 'Server-reported values; no inferred total or category reconciliation', cacheWriteTokens: 'Unavailable: not exposed by this endpoint', speedMeaning: 'Raw protocol speed is not a verified served service tier', billingMeaning: 'Service estimates are not a Codex subscription bill' } };
}
export function unavailableAccountUsage(reason, { params = {}, fetchedAt = Date.now() } = {}) {
  const result = envelope(validateAccountUsageParams(params), fetchedAt);
  result.reason = unavailableReasons.has(reason) ? reason : 'account-usage-unavailable';
  result.quality.missing.accountUsage = result.reason;
  return result;
}

export function normalizeAccountUsage(raw, { params = {}, fetchedAt = Date.now() } = {}) {
  const query = validateAccountUsageParams(params);
  if (!object(raw) || !object(raw.summary)) return unavailableAccountUsage('account-usage-schema-invalid', { params: query, fetchedAt });
  const result = envelope(query, fetchedAt), missing = result.quality.missing;
  const count = (value, field) => {
    const parsed = integer(value);
    if (parsed === null) missing[field] = value == null ? 'field-not-exposed' : 'invalid-nonnegative-safe-integer';
    return parsed;
  };
  if (result.fetchedAt === null) missing.fetchedAt = 'invalid-timestamp';
  for (const field of ACCOUNT_SUMMARY_FIELDS) result.summary[field] = count(raw.summary[field], `summary.${field}`);
  if (Array.isArray(raw.dailyUsageBuckets)) {
    result.dailyBuckets = [];
    if (raw.dailyUsageBuckets.length > 10000) missing.dailyBuckets = 'daily-bucket-limit-exceeded';
    const seen = new Set();
    for (const [index, bucket] of raw.dailyUsageBuckets.slice(0, 10000).entries()) {
      if (!object(bucket) || !date(bucket.startDate)) { missing[`dailyBuckets[${index}].startDate`] = 'invalid-date'; continue; }
      if (seen.has(bucket.startDate)) { missing[`dailyBuckets[${index}]`] = 'duplicate-date-not-combined'; continue; }
      seen.add(bucket.startDate);
      result.dailyBuckets.push({ startDate: bucket.startDate, tokens: count(bucket.tokens, `dailyBuckets[${index}].tokens`) });
    }
  } else missing.dailyBuckets = raw.dailyUsageBuckets == null ? 'field-not-exposed' : 'invalid-array';

  if (query.threadId) {
    const usage = raw.threadUsage;
    if (!object(usage)) {
      const reason = usage == null ? 'thread-usage-not-exposed' : 'thread-usage-invalid';
      result.threadUsage = emptyThread(reason);
      missing.threadUsage = reason;
    }
    else if (!isUuid(usage.threadId) || usage.threadId !== query.threadId) {
      result.threadUsage = emptyThread('thread-usage-identity-mismatch', false);
      missing.threadUsage = 'thread-usage-identity-mismatch';
    } else {
      const startMissing = Object.keys(missing).length;
      const creditsMicros = count(usage.estimatedUsageCreditsMicros, 'threadUsage.estimatedUsageCreditsMicros');
      const usdMicros = count(usage.estimatedUsageUsdMicros, 'threadUsage.estimatedUsageUsdMicros');
      const groups = [];
      if (!Array.isArray(usage.groups)) missing['threadUsage.groups'] = 'invalid-array';
      else {
        if (usage.groups.length > 1000) missing['threadUsage.groups'] = 'thread-group-limit-exceeded';
        for (const [index, group] of usage.groups.slice(0, 1000).entries()) {
          if (!object(group)) { missing[`threadUsage.groups[${index}]`] = 'invalid-group'; continue; }
          const row = { model: label(group.model), reasoningEffort: label(group.reasoningEffort), rawSpeed: label(group.speed) };
          for (const field of GROUP_NUMBERS) row[field] = count(group[field], `threadUsage.groups[${index}].${field}`);
          for (const field of ['model', 'reasoningEffort', 'speed']) if (label(group[field]) === null) missing[`threadUsage.groups[${index}].${field}`] = group[field] == null ? 'field-not-exposed' : 'invalid-label';
          row.estimateStatus = row.estimatedUsageCreditsMicros === null ? 'Unavailable' : 'Estimated';
          groups.push(row);
        }
      }
      result.threadUsage = { status: Object.keys(missing).length > startMissing ? 'Partial' : 'Estimated', reason: Object.keys(missing).length > startMissing ? 'thread-usage-partial' : null, identityMatched: true, estimates: { status: creditsMicros === null && usdMicros === null ? 'Unavailable' : 'Estimated', creditsMicros, usdMicros }, groups };
    }
  } else if (raw.threadUsage != null) missing.threadUsage = 'unrequested-thread-usage-omitted';

  const hasData = ACCOUNT_SUMMARY_FIELDS.some(field => result.summary[field] !== null) || result.dailyBuckets !== null || result.threadUsage.identityMatched === true;
  result.status = hasData ? Object.keys(missing).length ? 'Partial' : 'Observed' : 'Unavailable';
  result.reason = result.status === 'Observed' ? null : result.status === 'Partial' ? 'account-usage-partial' : 'account-usage-not-exposed';
  return result;
}
