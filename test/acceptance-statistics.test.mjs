import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ObservabilityService } from '../src/observability/index.mjs';
import { SqliteStore } from '../src/persistence/sqlite.mjs';

const T0 = Date.parse('2026-10-08T12:00:00.000Z');
const line = (at, type, payload) => JSON.stringify({ timestamp: new Date(at).toISOString(), type, payload }) + '\n';
const usage = (input, cached, write, output, reasoning = 0) => ({ input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: write,
  output_tokens: output, reasoning_output_tokens: reasoning, total_tokens: input + output });
const response = (at, id, tokens, extras = {}) => line(at, 'event_msg', { type: 'token_usage_record', response_id: id, usage: tokens, ...extras });
function rig(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccc-statistics-acceptance-'));
  fs.mkdirSync(path.join(home, 'sessions'));
  const database = path.join(home, 'statistics.sqlite');
  const store = new SqliteStore(database);
  const service = new ObservabilityService({ store, codexHome: home, now: () => T0 });
  t.after(() => { store.close(); fs.rmSync(home, { recursive: true, force: true }); });
  return { home, database, file: path.join(home, 'sessions', 'main.jsonl'), store, service };
}

test('statistics keep request, configured context, turn and token ledgers independent under partial response coverage', t => {
  const r = rig(t), rows = [];
  rows.push(line(T0, 'session_meta', { id: 'SYNTH_MAIN_THREAD', cwd: 'SYNTH_PATH', model_provider: 'openai', context_window: 870000 }));
  rows.push(line(T0 + 1, 'turn_context', { turn_id: 'SYNTH_TURN_A', model: 'gpt-6.1-sol', model_provider: 'openai', service_tier: 'priority', collaboration_mode: { mode: 'code', instructions: 'SYNTH_COLLAB_INSTRUCTIONS' } }));
  rows.push(response(T0 + 2, 'SYNTH_RESPONSE_A', usage(300001, 250000, 10000, 50000, 6000), { service_tier: 'priority' }));
  rows.push(response(T0 + 3, 'SYNTH_RESPONSE_B', usage(100000, 40000, 5000, 10000, 2000), { service_tier: 'priority' }));
  rows.push(line(T0 + 4, 'turn_context', { turn_id: 'SYNTH_TURN_B', model: 'gpt-6.1-sol', model_provider: 'openai', service_tier: 'default', collaboration_mode: { mode: 'plan' } }));
  r.service.observeTurnMetadata({ threadId: 'SYNTH_MAIN_THREAD', turnId: 'SYNTH_TURN_B', model: 'gpt-6.1-sol', provider: 'openai', rawServiceTier: 'default', effort: 'low', collaborationMode: 'plan', kind: 'goal', modelContextWindow: 870000, observedAt: T0 + 5, source: 'desktop-ipc' });
  rows.push(response(T0 + 6, 'SYNTH_RESPONSE_C', usage(500, 100, 20, 10), { turn_id: 'SYNTH_TURN_B' }));
  // This looks like usage but has no response ID and no cumulative/last counter: it cannot become a request record.
  rows.push(line(T0 + 7, 'event_msg', { type: 'token_usage_record', usage: usage(900, 100, 0, 20) }));
  fs.writeFileSync(r.file, rows.join(''));

  const providerMissingFile = path.join(r.home, 'sessions', 'provider-missing.jsonl');
  fs.writeFileSync(providerMissingFile,
    line(T0, 'session_meta', { id: 'SYNTH_UNKNOWN_PROVIDER_THREAD' }) +
    line(T0 + 1, 'turn_context', { turn_id: 'SYNTH_TURN_UNKNOWN_PROVIDER', model: 'gpt-6.1-sol', service_tier: 'priority' }) +
    response(T0 + 8, 'SYNTH_RESPONSE_PROVIDER_UNKNOWN', usage(300001, 100000, 10000, 20), { service_tier: 'priority' }));
  const unknownModelFile = path.join(r.home, 'sessions', 'unknown-model.jsonl');
  fs.writeFileSync(unknownModelFile,
    line(T0, 'session_meta', { id: 'SYNTH_UNKNOWN_MODEL_THREAD', model_provider: 'openai' }) +
    line(T0 + 1, 'turn_context', { turn_id: 'SYNTH_TURN_UNKNOWN_MODEL', model: 'gpt-future-unknown', model_provider: 'openai', service_tier: 'fast' }) +
    response(T0 + 9, 'SYNTH_RESPONSE_UNKNOWN_MODEL', usage(1000, 100, 0, 10), { service_tier: 'fast' }));

  const cumulativeFile = path.join(r.home, 'sessions', 'counter.jsonl');
  const initial = usage(77738040827, 700, 80, 218796327), next = usage(77738040927, 710, 85, 218796347);
  fs.writeFileSync(cumulativeFile,
    line(T0, 'session_meta', { id: 'SYNTH_COUNTER_THREAD', model_provider: 'openai', context_window: 870000 }) +
    line(T0 + 1, 'turn_context', { turn_id: 'SYNTH_COUNTER_TURN', model: 'gpt-6.1-sol', model_provider: 'openai', service_tier: 'fast' }) +
    line(T0 + 10, 'event_msg', { type: 'token_count', info: { total_token_usage: initial, model_context_window: 870000 } }) +
    line(T0 + 11, 'event_msg', { type: 'token_count', info: { total_token_usage: next, model_context_window: 870000 } }));

  const latestFile = path.join(r.home, 'sessions', 'latest.jsonl');
  fs.writeFileSync(latestFile,
    line(T0, 'session_meta', { id: 'SYNTH_LATEST_THREAD', model_provider: 'openai' }) +
    line(T0 + 1, 'turn_context', { turn_id: 'SYNTH_LATEST_TURN', model: 'gpt-6.1-sol', model_provider: 'openai', service_tier: 'standard' }) +
    line(T0 + 12, 'event_msg', { type: 'token_count', info: { last_token_usage: usage(300001, 100000, 10000, 20), model_context_window: 870000 } }));

  r.service.poll();
  const summary = r.service.summary({ groupBy: 'model' });
  const groups = summary.groups;
  const responseGroup = groups.find(g => g.key === 'gpt-6.1-sol' && g.ledger === 'response');
  const unknownModelGroup = groups.find(g => g.key === 'gpt-future-unknown' && g.ledger === 'response');
  const counterDelta = groups.find(g => g.key === 'gpt-6.1-sol' && g.ledger === 'cumulative-delta');
  const inventory = groups.find(g => g.ledger === 'baseline-counter-inventory');
  const latest = groups.find(g => g.key === 'gpt-6.1-sol' && g.ledger === 'latest-sample');
  assert.ok(responseGroup && unknownModelGroup && counterDelta && inventory && latest);

  // Four response records exist for this model, but one has no provider. Do not present the three known-provider rows as a total request count.
  assert.equal(responseGroup.samples, 4);
  assert.equal(responseGroup.requestCount, null);
  assert.equal(responseGroup.knownProviderRequestRecords, 3);
  assert.match(responseGroup.requestCountQuality, /missing response coverage is not inferred/);
  assert.equal(responseGroup.observedTurns, 3);
  assert.equal(responseGroup.turnTokenStatistics.samples, 3);
  assert.equal(responseGroup.turnTokenStatistics.missing, 0);
  assert.equal(responseGroup.turnTokenStatistics.p50, 300021); // One value per observed turn, not four response records.
  assert.equal(responseGroup.turnTokenStatistics.p95, 460001);
  assert.equal(responseGroup.longContextRequests, 1); // The unknown-provider long request is not an attributed API-price request.
  assert.equal(responseGroup.unknownRequestContext, 0);
  assert.equal(responseGroup.tierRequestCounts.fast, 2);
  assert.equal(responseGroup.tierRequestCounts.standard, 1);
  assert.equal(responseGroup.configuredContextWindowStatistics.samples, 3);
  assert.equal(responseGroup.configuredContextWindowStatistics.missing, 1);
  assert.equal(responseGroup.configuredContextWindowStatistics.mean, 870000);
  assert.equal(responseGroup.averageRequestInput, 175125.5);
  assert.equal(responseGroup.collaborationModeCounts.code, 2);
  assert.equal(responseGroup.collaborationModeCounts.plan, 1);
  assert.match(responseGroup.tierCountQuality, /may not confirm actual served response tiers/);
  const collaborationSummary = r.service.summary({ groupBy: 'collaboration' });
  assert.equal(collaborationSummary.groups.find(g => g.key === 'code' && g.ledger === 'response').samples, 2);
  const savedMetadata = JSON.stringify({ turns: r.store.db.prepare('SELECT metadata_json FROM turns').all(), usage: r.store.db.prepare('SELECT metadata_json FROM token_usage').all() });
  assert.equal(savedMetadata.includes('SYNTH_COLLAB_INSTRUCTIONS'), false); // Store the mode, never the instructions.

  assert.equal(unknownModelGroup.requestCount, 1);
  assert.equal(unknownModelGroup.unknownRequestContext, 1);
  assert.equal(unknownModelGroup.longContextRequests, 0);
  assert.equal(counterDelta.requestCount, null);
  assert.equal(counterDelta.knownProviderRequestRecords, null);
  assert.equal(counterDelta.turnTokenStatistics.p50, 120); // Counter-delta turn tokens stay in this ledger only.
  assert.equal(inventory.observedTurns, null);
  assert.equal(inventory.requestCount, null);
  assert.equal(inventory.turnTokenStatistics, null);
  assert.equal(inventory.tokens.total_tokens, null);
  assert.equal(latest.requestCount, null);
  assert.equal(latest.ledger, 'latest-sample');
  assert.equal(latest.turnTokenStatistics.samples, 0);
  assert.equal(latest.turnTokenStatistics.missing, 1);
  assert.equal(groups.every(group => group.canCombineWithOtherLedgers === false), true);
  assert.match(summary.coverage, /Response, counter-delta and latest-sample ledgers overlap and must not be added together/);
  assert.match(summary.coverage, /global\/root-child consumption is unverified/);
});

test('model/tier performance groups summarize observed turns only and keep model timing unavailable', t => {
  const r = rig(t), events = [
    line(T0, 'session_meta', { id: 'SYNTH_PERF_THREAD', model_provider: 'openai' }),
    line(T0 + 1, 'turn_context', { turn_id: 'SYNTH_FAST_TURN', model: 'gpt-6.1-sol', model_provider: 'openai', service_tier: 'priority' }),
    line(T0 + 1000, 'event_msg', { type: 'task_started' }),
    line(T0 + 2500, 'event_msg', { type: 'agent_message', message: 'SYNTH_VISIBLE_A' }),
    response(T0 + 9000, 'SYNTH_PERF_RESPONSE_A', usage(1000, 100, 20, 100), { service_tier: 'priority' }),
    line(T0 + 11000, 'event_msg', { type: 'task_complete' }),
    line(T0 + 20000, 'turn_context', { turn_id: 'SYNTH_STANDARD_TURN', model: 'gpt-6.1-sol', model_provider: 'openai', service_tier: 'default' }),
    line(T0 + 21000, 'event_msg', { type: 'task_started' }),
    line(T0 + 22500, 'event_msg', { type: 'agent_message', message: 'SYNTH_VISIBLE_B' }),
    response(T0 + 39000, 'SYNTH_PERF_RESPONSE_B', usage(2000, 200, 30, 80), { service_tier: 'default' }),
    line(T0 + 41000, 'event_msg', { type: 'task_complete' }),
  ];
  fs.writeFileSync(r.file, events.join(''));
  const otherProviderFile = path.join(r.home, 'sessions', 'other-provider.jsonl');
  fs.writeFileSync(otherProviderFile, [
    line(T0, 'session_meta', { id: 'SYNTH_PERF_OTHER_PROVIDER', model_provider: 'synthetic-provider' }),
    line(T0 + 1, 'turn_context', { turn_id: 'SYNTH_OTHER_PROVIDER_TURN', model: 'gpt-6.1-sol', model_provider: 'synthetic-provider', service_tier: 'priority' }),
    line(T0 + 51000, 'event_msg', { type: 'task_started' }),
    line(T0 + 52000, 'event_msg', { type: 'agent_message', message: 'SYNTH_VISIBLE_C' }),
    line(T0 + 61000, 'event_msg', { type: 'task_complete' }),
  ].join(''));
  r.service.poll();
  const performance = r.service.performanceSummary();
  assert.equal(performance.samples, 3);
  assert.equal(performance.ttft.status, 'Unavailable');
  assert.equal(performance.decode.status, 'Unavailable');
  assert.equal(performance.modelWaiting.status, 'Unavailable');
  assert.match(performance.attribution, /not isolated model performance/);
  const fast = performance.groups.find(group => group.model === 'gpt-6.1-sol' && group.serviceTier === 'fast');
  const standard = performance.groups.find(group => group.model === 'gpt-6.1-sol' && group.serviceTier === 'standard');
  const otherProvider = performance.groups.find(group => group.model === 'gpt-6.1-sol' && group.provider === 'synthetic-provider' && group.serviceTier === 'priority');
  assert.ok(fast && standard && otherProvider);
  assert.equal(fast.samples, 1);
  assert.equal(fast.metrics.wall.p50, 10000);
  assert.equal(fast.metrics.firstVisible.p50, 1500);
  assert.equal(fast.responseRecords, 1);
  assert.equal(fast.ttft.status, 'Unavailable');
  assert.equal(fast.decode.status, 'Unavailable');
  assert.equal(fast.modelWaiting.status, 'Unavailable');
  assert.equal(standard.samples, 1);
  assert.equal(standard.metrics.wall.p50, 20000);
  assert.equal(standard.responseRecords, 1);
  assert.equal(standard.attribution, undefined);
  assert.equal(otherProvider.samples, 1); // Same model and raw tier do not merge across providers.
  assert.equal(otherProvider.metrics.wall.p50, 10000);
  assert.equal(otherProvider.responseRecords, 0);
  assert.equal(otherProvider.ttft.status, 'Unavailable');
});
