import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ObservabilityService } from '../src/observability/index.mjs';
import { SqliteStore } from '../src/persistence/sqlite.mjs';

const t0 = Date.parse('2026-10-07T12:00:00.000Z');
const metaLines = () => [
  { timestamp: new Date(t0).toISOString(), type: 'session_meta', payload: {
    id: 'SYNTH_THREAD_ID_7F3A', cwd: 'SYNTH_PRIVATE_PATH_84B2', model_provider: 'openai',
    email: 'SYNTH_EMAIL_13DD', auth_token: 'SYNTH_AUTH_92A1',
  } },
  { timestamp: new Date(t0 + 1).toISOString(), type: 'turn_context', payload: {
    turn_id: 'SYNTH_TURN_ID_298A', model: 'gpt-6.1-sol', model_provider: 'openai',
    service_tier: 'standard', effort: 'high', cwd: 'SYNTH_PRIVATE_PATH_84B2', goal_id: 'SYNTH_GOAL_550E',
  } },
].map(value => JSON.stringify(value) + '\n').join('');
const counters = ({ input = 1000, cached = 100, write = 20, output = 100, reasoning = 10 } = {}) => ({
  input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: write,
  output_tokens: output, reasoning_output_tokens: reasoning, total_tokens: input + output,
});
const cumulative = (at, total, last = counters({ input: 100, cached: 10, write: 2, output: 10, reasoning: 1 })) => JSON.stringify({
  timestamp: new Date(at).toISOString(), type: 'event_msg', payload: {
    type: 'token_count', info: { total_token_usage: total, last_token_usage: last, model_context_window: 870000 },
  },
}) + '\n';
const response = (at, responseId, usage, extras = {}) => JSON.stringify({
  timestamp: new Date(at).toISOString(), type: 'event_msg', payload: {
    type: 'token_usage_record', response_id: responseId, usage,
    model_context_window: 870000, ...extras,
  },
}) + '\n';

function rig(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccc-observability-acceptance-'));
  const sessions = path.join(home, 'sessions');
  const archived = path.join(home, 'archived_sessions');
  fs.mkdirSync(sessions);
  const database = path.join(home, 'observability.sqlite');
  const file = path.join(sessions, 'rollout.jsonl');
  fs.writeFileSync(file, metaLines());
  let store = new SqliteStore(database, { now: () => t0 });
  let service = new ObservabilityService({ store, codexHome: home, now: () => t0 });
  t.after(() => { store.close(); fs.rmSync(home, { recursive: true, force: true }); });
  return {
    home, sessions, archived, file, database,
    get store() { return store; }, get service() { return service; },
    restart() { store.close(); store = new SqliteStore(database, { now: () => t0 }); service = new ObservabilityService({ store, codexHome: home, now: () => t0 }); },
  };
}

test('line-tail replay, actual archive move, and cumulative reset stay idempotent across SQLite restart', t => {
  const r = rig(t);
  const first = cumulative(t0 + 2, counters());
  fs.appendFileSync(r.file, first.slice(0, -2));
  assert.equal(r.service.poll().usage, 0); // Incomplete JSONL tail is held for the next poll.
  fs.appendFileSync(r.file, first.slice(-2));
  assert.equal(r.service.poll().usage, 1);
  assert.equal(r.service.poll().usage, 0);

  r.restart();
  fs.mkdirSync(r.archived);
  const moved = path.join(r.archived, 'rollout.jsonl');
  fs.renameSync(r.file, moved);
  assert.equal(r.service.poll().usage, 0); // A moved file is replayed at its new path, then deduped.

  const increased = counters({ input: 1500, cached: 150, write: 30, output: 150, reasoning: 20 });
  fs.appendFileSync(moved, cumulative(t0 + 3, increased));
  assert.equal(r.service.poll().usage, 1);
  fs.appendFileSync(moved, cumulative(t0 + 4, increased)); // New snapshot, same cumulative totals.
  assert.equal(r.service.poll().usage, 1);
  fs.appendFileSync(moved, cumulative(t0 + 5, counters({ input: 80, cached: 8, write: 2, output: 8, reasoning: 2 })));
  assert.equal(r.service.poll().discontinuities, 1);
  assert.equal(r.service.poll().usage, 0);

  // A late pre-reset snapshot is retained as inventory but cannot roll back the reset baseline.
  fs.appendFileSync(moved, cumulative(t0 + 4, counters({ input: 1400, cached: 140, write: 28, output: 140, reasoning: 16 })));
  assert.equal(r.service.poll().usage, 1);
  fs.appendFileSync(moved, cumulative(t0 + 6, counters({ input: 120, cached: 12, write: 4, output: 12, reasoning: 3 })));
  assert.equal(r.service.poll().usage, 1);

  const groups = r.service.summary({ groupBy: 'thread' }).groups;
  const delta = groups.find(g => g.ledger === 'cumulative-delta');
  const inventory = groups.find(g => g.ledger === 'baseline-counter-inventory');
  // Only observed counter changes within epochs add: +500 before reset, +40 after reset.
  assert.equal(delta.tokens.input_tokens, 540);
  assert.equal(delta.tokens.cached_input_tokens, 54);
  assert.equal(delta.tokens.cache_write_input_tokens, 12);
  assert.equal(delta.tokens.output_tokens, 54);
  assert.equal(delta.tokens.reasoning_output_tokens, 11); // Reasoning is a reported subset of output.
  assert.equal(delta.tokens.total_tokens, 594); // input + output; do not add cache/reasoning again.
  assert.equal(delta.additiveWithinLedger, true);
  assert.equal(delta.canCombineWithOtherLedgers, false);
  assert.equal(inventory.samples, 3); // Initial, reset, and late/out-of-order snapshots.
  assert.equal(inventory.tokens.input_tokens, null);
  assert.equal(inventory.counterInventoryStats.input_tokens.max, 1400);
  assert.equal(inventory.counterInventoryStats.total_tokens.max, 1540);
  assert.equal(inventory.estimatedUsd, null);
  assert.equal(inventory.pricingStatus, 'Unavailable');
  assert.equal(inventory.additiveWithinLedger, false);
  assert.equal(inventory.canCombineWithOtherLedgers, false);
  assert.equal(inventory.discontinuities, 1);
  assert.equal(r.service.rows('token_usage').filter(row => row.outOfOrder).length, 1);
  assert.match(r.service.summary().coverage, /initial\/reset\/reordered counters are non-additive inventory/);
  const byModel = r.service.summary({ groupBy: 'model' }).groups.find(g => g.ledger === 'baseline-counter-inventory');
  assert.equal(byModel.key, 'Counter inventory (unknown attribution)');
});

test('legacy initial-counter flags remain inventory and cannot produce a price', t => {
  const r = rig(t);
  const legacy = { threadId: 'SYNTH_LEGACY_THREAD_1A', turnId: 'SYNTH_LEGACY_TURN_2B', model: 'gpt-6.1-sol', provider: 'openai', serviceTier: 'standard', timestamp: t0,
    scope: 'cumulative-delta', initialCounter: true, usage: counters({ input: 77738040827, cached: 700, write: 80, output: 218796327, reasoning: 100 }) };
  const original = JSON.stringify(legacy);
  r.store.db.prepare('INSERT INTO token_usage VALUES(?,?,?,?)').run('legacy-baseline-fixture', legacy.threadId, legacy.turnId, original);

  const summary = r.service.summary({ groupBy: 'thread' });
  const inventory = summary.groups.find(g => g.ledger === 'baseline-counter-inventory');
  assert.ok(inventory);
  assert.equal(inventory.samples, 1);
  assert.equal(inventory.tokens.total_tokens, null);
  assert.equal(inventory.counterInventoryStats.input_tokens.max, 77738040827);
  assert.equal(inventory.estimatedUsd, null);
  assert.equal(inventory.pricingStatus, 'Unavailable');
  assert.equal(inventory.tokenTotalStatus, 'Non-additive counter inventory; not consumption');
  assert.equal(inventory.additiveWithinLedger, false);
  assert.equal(summary.coverage.includes('global/root-child consumption is unverified'), true);
  assert.equal(r.store.db.prepare('SELECT metadata_json FROM token_usage WHERE id=?').get('legacy-baseline-fixture').metadata_json, original);
});

test('actual response IDs, counter deltas, and counter inventory remain separate ledgers', t => {
  const r = rig(t);
  const baseline = counters({ input: 1000, cached: 100, write: 20, output: 100, reasoning: 10 });
  const advanced = counters({ input: 1100, cached: 110, write: 25, output: 120, reasoning: 12 });
  const actual = counters({ input: 40, cached: 10, write: 5, output: 10, reasoning: 3 });
  fs.appendFileSync(r.file, cumulative(t0 + 2, baseline) + cumulative(t0 + 3, advanced) + response(t0 + 4, 'SYNTH_RESPONSE_SHARED_310C', actual));
  const forkFile = path.join(r.sessions, 'fork.jsonl');
  fs.writeFileSync(forkFile, [
    { timestamp: new Date(t0).toISOString(), type: 'session_meta', payload: { id: 'SYNTH_FORK_THREAD_481B', parent_thread_id: 'SYNTH_THREAD_ID_7F3A', model_provider: 'openai' } },
    { timestamp: new Date(t0 + 1).toISOString(), type: 'turn_context', payload: { turn_id: 'SYNTH_FORK_TURN_18A0', model: 'gpt-6.1-sol', model_provider: 'openai', service_tier: 'standard' } },
  ].map(value => JSON.stringify(value) + '\n').join('') + response(t0 + 5, 'SYNTH_RESPONSE_SHARED_310C', actual));
  r.service.poll();

  const summary = r.service.summary({ groupBy: 'thread' });
  const responseGroup = summary.groups.find(g => g.ledger === 'response');
  const delta = summary.groups.find(g => g.ledger === 'cumulative-delta');
  const inventory = summary.groups.find(g => g.ledger === 'baseline-counter-inventory');
  assert.ok(responseGroup && delta && inventory);
  assert.equal(responseGroup.samples, 1); // Same provider/response ID in the fork is deduped.
  assert.equal(responseGroup.tokens.input_tokens, 40);
  assert.equal(responseGroup.tokens.output_tokens, 10);
  assert.equal(responseGroup.inputSamples, 1); // Actual per-response input, not cumulative context.
  assert.equal(responseGroup.pricingStatus, 'Estimated');
  assert.equal(delta.tokens.input_tokens, 100);
  assert.equal(delta.tokens.output_tokens, 20);
  assert.equal(inventory.tokens.input_tokens, null);
  assert.equal(inventory.estimatedUsd, null);
  assert.equal(summary.duplicateResponseRecords, 1);
  assert.equal(summary.groups.every(g => g.canCombineWithOtherLedgers === false), true);
  assert.equal(Object.hasOwn(summary, 'estimatedUsd'), false); // No synthesized cross-ledger total.
  assert.equal(summary.coverage.includes('Response, counter-delta and latest-sample ledgers overlap and must not be added together'), true);
  assert.equal(summary.coverage.includes('global/root-child consumption is unverified'), true);
});

test('pricing uses request input at the exact context boundary and keeps historical policy snapshots', t => {
  const r = rig(t);
  const service = r.service;
  const request = (inputTokens, overrides = {}) => ({
    timestamp: t0, provider: 'openai', model: 'gpt-6.1-sol', serviceTier: 'standard', scope: 'response',
    usage: counters({ input: inputTokens, cached: 100, write: 50, output: 100, reasoning: 30 }), ...overrides,
  });
  const estimate = (inputTokens, overrides = {}) => service.pricing.estimate(request(inputTokens, overrides));
  const atBoundary = estimate(272000);
  const overBoundary = estimate(272001);
  assert.equal(atBoundary.context, 'short');
  assert.equal(atBoundary.usd, (271850 * 2 + 100 * 0.1 + 50 * 2.5 + 100 * 10) / 1e6);
  assert.equal(overBoundary.context, 'long');
  assert.equal(overBoundary.usd, (271851 * 4 + 100 * 0.2 + 50 * 5 + 100 * 15) / 1e6); // Long rates apply to all tokens.

  const fast = estimate(1000, { serviceTier: 'fast' });
  assert.equal(fast.usd, estimate(1000).usd * 2);
  assert.equal(estimate(1000, { serviceTier: 'priority' }).usd, fast.usd);
  assert.equal(estimate(1000, { provider: null }).reason, 'provider-missing');
  assert.equal(estimate(1000, { model: 'future-provider-model' }).reason, 'model-provider-tier-price-missing');
  assert.equal(estimate(1000, { serviceTier: null }).reason, 'processing-tier-missing');
  assert.equal(estimate(1000, { timestamp: 0 }).reason, 'historical-price-not-established');

  const missingWrite = request(1000); missingWrite.usage.cache_write_input_tokens = null;
  assert.equal(service.pricing.estimate(missingWrite).status, 'Partial');
  assert.equal(service.pricing.estimate(request(1000, { scope: 'cumulative-delta' })).reason, 'individual-request-input-unavailable');
  assert.equal(service.pricing.estimate(request(1000, { usage: counters({ input: 100, cached: 80, write: 30 }) })).reason, 'inconsistent-token-categories');
  assert.equal(service.pricing.estimate(request(1000, { usage: counters({ input: 100, cached: 10, write: 0, output: 20, reasoning: 21 }) })).reason, 'inconsistent-token-categories');

  const future = structuredClone(service.pricing.policy);
  future.id = 'synthetic-future-snapshot';
  future.retrievedAt = '2026-10-08T00:00:00.000Z';
  future.rows[0].short.input = 999;
  service.pricing.manualOverride(future, { confirmed: true });
  assert.equal(service.pricing.estimate(request(1000)).snapshotId, 'official-2026-10-07');
  assert.equal(service.pricing.estimate(request(1000, { timestamp: Date.parse('2026-10-08T01:00:00Z') })).snapshotId, 'synthetic-future-snapshot');
});

test('a large configured context window does not price a small actual request as long context', t => {
  const r = rig(t);
  fs.appendFileSync(r.file, response(t0 + 2, 'SYNTH_RESPONSE_SMALL_11A0', counters({ input: 1000, cached: 100, write: 50, output: 40, reasoning: 5 })));
  assert.equal(r.service.poll().usage, 1);
  const group = r.service.summary({ groupBy: 'model' }).groups.find(g => g.ledger === 'response');
  assert.equal(group.inputSamples, 1); // Aggregate only; individual request input arrays are not returned.
  assert.equal(group.inputP50, 1000);
  assert.equal(group.longContextSamples, 0);
  assert.equal(group.pricingStatus, 'Estimated');
  assert.equal(group.estimatedUsd, (850 * 2 + 100 * 0.1 + 50 * 2.5 + 40 * 10) / 1e6);
});

test('latest token snapshots remain non-additive while equal-count distinct response IDs remain separate calls', t => {
  const r = rig(t);
  const latest = value => JSON.stringify({
    timestamp: new Date(value.at).toISOString(), type: 'event_msg', payload: {
      type: 'token_count', info: { last_token_usage: counters({ input: value.input, cached: 20, write: 5, output: 30, reasoning: 8 }), model_context_window: 870000 },
    },
  }) + '\n';
  fs.appendFileSync(r.file, latest({ at: t0 + 2, input: 200 }) + latest({ at: t0 + 3, input: 300 }));
  assert.equal(r.service.poll().usage, 2);
  const latestGroup = r.service.summary({ groupBy: 'model' }).groups.find(g => g.ledger === 'latest-sample');
  assert.equal(latestGroup.samples, 2);
  assert.equal(latestGroup.countLabel, 'Usage samples');
  assert.equal(latestGroup.tokenTotalStatus.startsWith('Unavailable'), true);
  assert.equal(latestGroup.tokens.input_tokens, null);
  assert.equal(latestGroup.inputSamples, 0); // These are not unique actual request records.
  assert.equal(latestGroup.inputP50, null);
  assert.equal(latestGroup.estimatedUsd, null);

  fs.appendFileSync(r.file,
    response(t0 + 4, 'SYNTH_RESPONSE_ID_A100', counters({ input: 200, cached: 20, write: 5, output: 30, reasoning: 8 })) +
    response(t0 + 5, 'SYNTH_RESPONSE_ID_B200', counters({ input: 200, cached: 20, write: 5, output: 30, reasoning: 8 })));
  assert.equal(r.service.poll().usage, 2);
  const responseGroup = r.service.summary({ groupBy: 'model' }).groups.find(g => g.ledger === 'response');
  assert.equal(responseGroup.samples, 2);
  assert.equal(responseGroup.countLabel, 'Response records');
  assert.equal(responseGroup.tokens.input_tokens, 400); // Same counts can be two distinct model responses.
  assert.equal(responseGroup.inputSamples, 2);
});

test('performance remains locally observed, tool durations are overlap-safe, and diagnostics omit synthetic secrets', t => {
  const r = rig(t);
  const at = (ms, type, payload = {}) => JSON.stringify({ timestamp: new Date(t0 + ms).toISOString(), type: 'event_msg', payload: { type, ...payload } }) + '\n';
  fs.appendFileSync(r.file,
    at(0, 'task_started') +
    at(1000, 'tool_call_begin', { call_id: 'SYNTH_CALL_A' }) +
    at(2000, 'tool_call_begin', { call_id: 'SYNTH_CALL_B' }) +
    at(3000, 'agent_message', { message: 'SYNTH_PRIVATE_PROMPT_6C2A' }) +
    at(4000, 'tool_call_end', { call_id: 'SYNTH_CALL_A', arguments: 'SYNTH_TOOL_ARGS_66B1' }) +
    at(5000, 'tool_call_end', { call_id: 'SYNTH_CALL_B' }) +
    at(10000, 'task_complete'));
  r.service.poll();
  const perf = r.service.performanceSummary();
  assert.equal(perf.metrics.wall.p50, 10000);
  assert.equal(perf.metrics.wall.label, 'Observed turn wall time');
  assert.equal(perf.metrics.firstVisible.p50, 3000);
  assert.equal(perf.metrics.firstVisible.label, 'Observed first-visible-output latency');
  assert.equal(perf.metrics.tool.p50, 4000);
  assert.equal(perf.metrics.tool.label, 'Observed tool wall time (overlap-safe)');
  assert.equal(perf.ttft.status, 'Unavailable');
  assert.equal(perf.decode.status, 'Unavailable');

  const exported = JSON.stringify(r.service.exportDiagnostics());
  for (const secret of ['SYNTH_THREAD_ID_7F3A','SYNTH_TURN_ID_298A','SYNTH_GOAL_550E','SYNTH_PRIVATE_PATH_84B2','SYNTH_EMAIL_13DD','SYNTH_AUTH_92A1','SYNTH_PRIVATE_PROMPT_6C2A','SYNTH_TOOL_ARGS_66B1']) {
    assert.equal(exported.includes(secret), false, `diagnostics leaked ${secret}`);
  }
  const stored = JSON.stringify(r.store.db.prepare('SELECT * FROM token_usage').all());
  assert.equal(stored.includes('SYNTH_PRIVATE_PROMPT_6C2A'), false);
  assert.equal(stored.includes('SYNTH_TOOL_ARGS_66B1'), false);
});

test('quota correlation stays low-confidence aggregate evidence and never claims a token conversion', t => {
  const r = rig(t);
  let cumulativeInput = 100;
  let cumulativeOutput = 10;
  fs.appendFileSync(r.file, cumulative(t0 + 1000, counters({ input: cumulativeInput, cached: 0, write: 0, output: cumulativeOutput, reasoning: 0 })));
  const tokenDeltasByHour = [[100, 100], [200, 100], [300, 100]];
  const usedPairsByHour = [[5, 15], [25, 45], [55, 85]];
  for (let hour = 0; hour < 3; hour++) {
    for (let point = 0; point < 2; point++) {
      cumulativeInput += tokenDeltasByHour[hour][point];
      cumulativeOutput += 10;
      const at = t0 + hour * 3600000 + (point ? 35 : 5) * 60000;
      fs.appendFileSync(r.file, cumulative(at, counters({ input: cumulativeInput, cached: 0, write: 0, output: cumulativeOutput, reasoning: 0 })));
      const used = usedPairsByHour[hour][point];
      r.store.sampleQuota({ rateLimitsByLimitId: { codex: { primary: { usedPercent: used, windowDurationMins: 300 }, secondary: { usedPercent: used, windowDurationMins: 10080 } } } }, at, 'synthetic-quota');
    }
  }
  r.service.poll();
  const result = r.service.quotaCorrelation({ since: t0 });
  assert.equal(result.confidence, 'low');
  assert.match(result.label, /no official quota-token conversion/);
  assert.equal(result.correlations.length, 2);
  for (const correlation of result.correlations) {
    assert.equal(correlation.samples, 3);
    assert.equal(correlation.status, 'Estimated');
    assert.equal(correlation.pearson, 1);
    assert.equal(Object.hasOwn(correlation, 'threadId'), false);
  }
  assert.equal(result.buckets.every(bucket => bucket.tokenTotal != null && bucket.resetOrDiscontinuity === false), true);
  assert.equal(result.buckets.some(bucket => Object.hasOwn(bucket, 'threadId')), false);
});
