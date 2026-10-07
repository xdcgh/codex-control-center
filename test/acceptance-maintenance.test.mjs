import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ObservabilityClient } from '../src/core/observability-client.mjs';
import { ControlCenterCore } from '../src/core/control-center.mjs';
import { createRouter } from '../src/core/router.mjs';
import { SqliteStore } from '../src/persistence/sqlite.mjs';

const DAY = 86400000, HOUR = 3600000;
function temp(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ccc-maintenance-acceptance-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function oldV1Database(file, base) {
  const db = new DatabaseSync(file);
  try {
    db.exec(`CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE threads(thread_id TEXT PRIMARY KEY,record_json TEXT NOT NULL);
      CREATE TABLE recovery_intents(attempt_key TEXT PRIMARY KEY,intent_json TEXT NOT NULL);
      CREATE TABLE thread_policies(thread_id TEXT PRIMARY KEY,policy_json TEXT NOT NULL);
      CREATE TABLE quota_samples(timestamp INTEGER NOT NULL,limit_id TEXT NOT NULL,window INTEGER NOT NULL,used_percent REAL NOT NULL,remaining_percent REAL NOT NULL,reset_at INTEGER,credits_json TEXT,source TEXT NOT NULL,codex_version TEXT,PRIMARY KEY(timestamp,limit_id,window));
      CREATE TABLE quota_history_aggregates(day INTEGER NOT NULL,limit_id TEXT NOT NULL,window INTEGER NOT NULL,reset_key TEXT NOT NULL,samples INTEGER NOT NULL,used_sum REAL NOT NULL,used_min REAL NOT NULL,used_max REAL NOT NULL,first_timestamp INTEGER NOT NULL,last_timestamp INTEGER NOT NULL,PRIMARY KEY(day,limit_id,window,reset_key));
      CREATE TABLE turns(turn_id TEXT PRIMARY KEY,thread_id TEXT NOT NULL,metadata_json TEXT NOT NULL);
      CREATE TABLE goals(thread_id TEXT PRIMARY KEY,metadata_json TEXT NOT NULL);
      CREATE TABLE token_usage(id TEXT PRIMARY KEY,thread_id TEXT NOT NULL,turn_id TEXT,metadata_json TEXT NOT NULL);
      CREATE TABLE model_calls(id TEXT PRIMARY KEY,metadata_json TEXT NOT NULL);
      CREATE TABLE performance_samples(id TEXT PRIMARY KEY,metadata_json TEXT NOT NULL);
      CREATE TABLE pricing_snapshots(id TEXT PRIMARY KEY,metadata_json TEXT NOT NULL);
      CREATE TABLE app_versions(id TEXT PRIMARY KEY,metadata_json TEXT NOT NULL);
      INSERT INTO settings VALUES('core-settings','{"autoResume":true,"historySampleSeconds":60}');
      INSERT INTO threads VALUES('SYNTH_THREAD_V1','{"threadId":"SYNTH_THREAD_V1","phase":"waitingQuota"}');
      INSERT INTO recovery_intents VALUES('SYNTH_INTENT_V1','{"threadId":"SYNTH_THREAD_V1","phase":"uncertain"}');
      INSERT INTO thread_policies VALUES('SYNTH_THREAD_V1','{"manualPaused":true}');
      INSERT INTO quota_samples VALUES(${base + 60000},'codex',300,25,75,${base + DAY},NULL,'fixture','v1');
      INSERT INTO quota_history_aggregates VALUES(${base},'codex',300,'${base + DAY}',2,50,20,30,${base},${base + 3600000});
      PRAGMA user_version=1;`);
  } finally { db.close(); }
}

test('v1 migration snapshots the pre-migration database and preserves ledger/history provenance', t => {
  const directory = temp(t), file = path.join(directory, 'legacy.sqlite'), base = Date.UTC(2026, 0, 1);
  oldV1Database(file, base);
  const store = new SqliteStore(file, { now: () => base + 100 * DAY });
  try {
    assert.equal(store.schemaVersion, 2);
    assert.deepEqual(store.migrationHistory().map(row => row.version), [1, 2]);
    assert.equal(store.load().records.SYNTH_THREAD_V1.phase, 'waitingQuota');
    assert.equal(store.load().ledger.SYNTH_INTENT_V1.phase, 'uncertain');
    assert.equal(store.getThreadPolicy('SYNTH_THREAD_V1').manualPaused, true);
    assert.equal(store.getSetting('history-legacy-aggregation').quality, 'Partial');
    const aggregate = store.queryQuotaAggregates({ since: base, until: base + DAY })[0];
    assert.equal(aggregate.samples, 2);
    assert.equal(aggregate.quality, 'Partial legacy aggregate');
    assert.equal(fs.existsSync(store.migrationBackup), true);
    const backup = new DatabaseSync(store.migrationBackup, { readOnly: true });
    try {
      assert.equal(backup.prepare('PRAGMA user_version').get().user_version, 1);
      assert.equal(backup.prepare('SELECT record_json FROM threads WHERE thread_id=?').get('SYNTH_THREAD_V1').record_json, '{"threadId":"SYNTH_THREAD_V1","phase":"waitingQuota"}');
    } finally { backup.close(); }

    // A migrated historical aggregate and a raw row already within it are not folded twice.
    const result = store.maintainHistory(base + 100 * DAY, { retentionDays: 180 });
    assert.equal(result.aggregatedRemoved, 1);
    assert.equal(store.queryQuotaAggregates({ since: base, until: base + DAY })[0].samples, 2);
    assert.equal(store.queryQuotaChart({ since: base, until: base + DAY, maxPoints: 64 }).sourceCount, 2);
  } finally { store.close(); }
});

test('long history retention stores daily aggregates, preserves reset groups, and remains idempotent across restart', t => {
  const directory = temp(t), file = path.join(directory, 'history.sqlite'), base = Date.UTC(2026, 0, 1), now = base + 180 * DAY;
  let store = new SqliteStore(file, { now: () => now });
  const windows = [];
  for (let day = 0; day < 180; day++) for (let slot = 0; slot < 4; slot++) {
    const timestamp = base + day * DAY + slot * 6 * HOUR;
    const primaryReset = base + (day + 1) * DAY;
    const weeklyReset = base + (Math.floor(day / 7) + 1) * 7 * DAY;
    const primaryUsed = (slot + 1) * 10;
    const weeklyUsed = (day % 7) * 10 + slot * 5;
    store.sampleQuota({ rateLimitsByLimitId: { codex: {
      primary: { usedPercent: primaryUsed, windowDurationMins: 300, resetsAt: primaryReset / 1000 },
      secondary: { usedPercent: weeklyUsed, windowDurationMins: 10080, resetsAt: weeklyReset / 1000 },
    } } }, timestamp, 'synthetic-history', 'fixture');
  }
  const before = store.queryQuotaHistory({ since: base, limit: 10000 }).length;
  assert.equal(before, 180 * 4 * 2);
  const maintained = store.maintainHistory(now);
  assert.equal(maintained.retentionDays, 180);
  assert.equal(maintained.aggregatedRemoved, 150 * 4 * 2);
  assert.equal(store.queryQuotaHistory({ since: now - 30 * DAY, limit: 10000 }).length, 30 * 4 * 2);

  let aggregates = store.queryQuotaAggregates({ since: base, until: base + 150 * DAY });
  assert.equal(aggregates.length, 150 * 2); // Daily groups remain separate by window/reset.
  const primaryDay5 = aggregates.find(row => row.day === base + 5 * DAY && row.window === 300);
  assert.deepEqual({ samples: primaryDay5.samples, mean: primaryDay5.used_mean, min: primaryDay5.used_min, max: primaryDay5.used_max,
    first: primaryDay5.first_used_percent, last: primaryDay5.last_used_percent }, { samples: 4, mean: 25, min: 10, max: 40, first: 10, last: 40 });
  const chart = store.queryQuotaChart({ since: base, until: now, maxPoints: 1000 });
  assert.equal(chart.sourceCount, before);
  assert.equal(chart.hasAggregates, true);
  assert.ok(chart.samples.some(row => row.pointKind === 'daily-mean' && row.samples === 4));
  assert.equal(chart.samples.some(row => row.pointKind === 'daily-mean' && row.used_min == null), false);
  assert.ok(chart.samples.some(row => row.window === 300 && row.reset_at === primaryDay5.reset_key * 1));

  const firstAggregateCount = aggregates.reduce((n, row) => n + row.samples, 0);
  store.close(); store = new SqliteStore(file, { now: () => now });
  assert.equal(store.queryQuotaAggregates({ since: base, until: base + 150 * DAY }).reduce((n, row) => n + row.samples, 0), firstAggregateCount);
  assert.equal(store.maintainHistory(now).aggregatedRemoved, 0);
  assert.equal(store.queryQuotaAggregates({ since: base, until: base + 150 * DAY }).reduce((n, row) => n + row.samples, 0), firstAggregateCount);

  const later = now + 20 * DAY;
  const pruned = store.maintainHistory(later);
  assert.equal(pruned.retentionDays, 180);
  assert.ok(pruned.expiredAggregates > 0);
  assert.equal(store.queryQuotaHistory({ since: later - 30 * DAY, limit: 10000 }).length, 10 * 4 * 2);
  aggregates = store.queryQuotaAggregates({ since: later - 180 * DAY, until: later });
  assert.equal(aggregates.some(row => row.day < later - 180 * DAY), false);
  store.close();
});

test('unknown schema and corrupted files fail closed without replacement; confirmed restore preserves original and disables automatic starts', t => {
  const directory = temp(t), unknown = path.join(directory, 'future.sqlite');
  const futureDb = new DatabaseSync(unknown); futureDb.exec('PRAGMA user_version=99;'); futureDb.close();
  const futureBytes = fs.readFileSync(unknown);
  assert.throws(() => new SqliteStore(unknown), /database-schema-newer-than-app/);
  assert.deepEqual(fs.readFileSync(unknown), futureBytes);

  const file = path.join(directory, 'control-center.sqlite'), backupFile = path.join(directory, 'known-good.sqlite');
  const initial = new SqliteStore(file);
  initial.setSetting('core-settings', { autoResume: true, historySampleSeconds: 60 });
  initial.save({ schemaVersion: 1, startedAt: 'synthetic', records: { SYNTH_THREAD: { threadId: 'SYNTH_THREAD', phase: 'waitingQuota' } }, ledger: { SYNTH_INTENT: { threadId: 'SYNTH_THREAD', phase: 'uncertain' } } });
  assert.equal(initial.backup(backupFile).integrity, 'ok');
  initial.close();

  const corruptBytes = Buffer.from('SYNTHETIC-CORRUPT-DATABASE');
  fs.writeFileSync(file, corruptBytes);
  assert.throws(() => new SqliteStore(file));
  assert.deepEqual(fs.readFileSync(file), corruptBytes);
  const walBytes = Buffer.from('SYNTHETIC-WAL-PRESERVE'), shmBytes = Buffer.from('SYNTHETIC-SHM-PRESERVE');
  fs.writeFileSync(file + '-wal', walBytes); fs.writeFileSync(file + '-shm', shmBytes);
  assert.throws(() => SqliteStore.recoverDatabase({ file, backupFile }), /confirmation-and-quiescence-required/);
  assert.deepEqual(fs.readFileSync(file), corruptBytes);

  const offlineProof = target => ({ database: target, verified: true, activeOwners: 0 });
  assert.throws(() => SqliteStore.recoverDatabase({ file, backupFile, confirmed: true, quiescent: true }), /verified-offline-proof-required/);
  assert.deepEqual(fs.readFileSync(file), corruptBytes);
  const liveOwnerMarker = path.join(directory, 'daemon.lock');
  fs.writeFileSync(liveOwnerMarker, JSON.stringify({ pid: process.pid }));
  assert.throws(() => SqliteStore.recoverDatabase({ file, backupFile, confirmed: true, quiescent: true, verifyOffline: offlineProof }), /database-recovery-live/);
  fs.rmSync(liveOwnerMarker);
  assert.deepEqual(fs.readFileSync(file), corruptBytes);
  const recovery = SqliteStore.recoverDatabase({ file, backupFile, confirmed: true, quiescent: true, verifyOffline: offlineProof });
  assert.equal(recovery.restored, true);
  assert.equal(recovery.originalPreserved, true);
  assert.equal(recovery.requiresReview, true);
  const preservedFile = path.join(recovery.preservedDirectory, path.basename(file));
  assert.deepEqual(fs.readFileSync(preservedFile), corruptBytes);
  assert.deepEqual(fs.readFileSync(preservedFile + '-wal'), walBytes);
  assert.deepEqual(fs.readFileSync(preservedFile + '-shm'), shmBytes);
  const restored = new SqliteStore(file);
  try {
    assert.equal(restored.getSetting('core-settings').autoResume, false);
    assert.equal(restored.getSetting('database-recovery').requiresReview, true);
    assert.equal(restored.getSetting('database-recovery').ledgerCompleteness.startsWith('Unknown'), true);
    assert.equal(restored.load().records.SYNTH_THREAD.phase, 'waitingQuota');
    assert.equal(restored.load().ledger.SYNTH_INTENT.phase, 'uncertain');
    assert.throws(() => restored.acknowledgeRecovery(), /confirmation-required/);
    assert.deepEqual(restored.acknowledgeRecovery({ confirmed: true }), { reviewRequired: false, autoResume: false });
    assert.equal(restored.getSetting('database-recovery').requiresReview, false);
    assert.ok(Number.isFinite(restored.getSetting('database-recovery').reviewedAt));
    assert.equal(restored.getSetting('core-settings').autoResume, false);
  } finally { restored.close(); }
});

test('Core recovery-review fence blocks automatic enablement and manual Resume until explicit review acknowledgement', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ccc-maintenance-core-review-'));
  const store = new SqliteStore(path.join(directory, 'control.sqlite'));
  const threadId = '00000000-0000-4000-8000-000000000041';
  let quotaReads = 0, deliveries = 0;
  const adapter = {
    source: 'synthetic-recovery-review-test', compatibility: { verified: true },
    desktop: { getGeneration: () => 0, async snapshot() { throw new Error('unexpected-desktop-snapshot'); }, async request() { deliveries++; } },
    account: { async request() { return {}; } },
    async readQuota() { quotaReads++; return {}; }, async connect() {}, async close() {},
    async snapshot() { throw new Error('unexpected-snapshot'); }, isEligible: () => true, verifyWriteSafety() {}, unfollow() {},
    async doctor() { return { compatibility: { verified: true }, checks: { protocol: { status: 'passed' }, quota: { status: 'passed' }, modelCatalog: { status: 'passed' } } }; },
  };
  store.setSetting('core-settings', { autoResume: false, recoveryPollSeconds: 10, historySampleSeconds: 60, maxConcurrentResumes: 1, reservePercent: 10, maxRetries: 3, cooldownSeconds: 30 });
  store.setSetting('database-recovery', { requiresReview: true, ledgerCompleteness: 'Unknown until reviewed' });
  const core = new ControlCenterCore({ adapter, store, settings: { autoResume: false }, execute: true, now: () => Date.UTC(2026, 0, 1) });
  t.after(async () => { await core.close(); store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  core.engine.state.records[threadId] = { threadId, failureTurnId: '10000000-0000-4000-8000-000000000041', phase: 'waitingQuota', kind: 'ordinary', failedAt: Date.UTC(2026, 0, 1) };
  core.engine.save();

  assert.throws(() => core.setSettings({ autoResume: true }), /database-recovery-review-required/);
  assert.equal(core.snapshot().settings.autoResume, false);
  assert.throws(() => core.setThreadPolicy(threadId, { autoResume: true }), /database-recovery-review-required/);
  await assert.rejects(core.resumeNow(threadId), /database-recovery-review-required/);
  assert.equal(quotaReads, 0);
  assert.equal(deliveries, 0);

  const router = createRouter({ core, store, adapter });
  await assert.rejects(router({ method: 'database/acknowledge', params: { confirmed: false } }), /confirmation-required/);
  const acknowledged = await router({ method: 'database/acknowledge', params: { confirmed: true } });
  assert.equal(acknowledged.acknowledged, true);
  assert.equal(store.getSetting('core-settings').autoResume, false);
  assert.equal(store.getSetting('database-recovery').requiresReview, false);
  assert.equal(core.setSettings({ autoResume: true }).settings.autoResume, true);
});

test('pricing override router uses isolated Worker SQLite and preserves immutable snapshots without fetching official prices', async t => {
  const directory = temp(t), home = path.join(directory, 'codex-home');
  fs.mkdirSync(path.join(home, 'sessions'), { recursive: true });
  const database = path.join(directory, 'analytics.sqlite');
  const observer = new ObservabilityClient({ database, codexHome: home });
  const router = createRouter({ core: {}, store: {}, adapter: {}, observability: observer });
  let observerClosed = false;
  t.after(async () => { if (!observerClosed) await observer.close(); });
  const before = await router({ method: 'pricing/snapshots' });
  assert.ok(before.length >= 1);
  const original = structuredClone(before.at(-1));
  const override = structuredClone(original);
  override.id = 'acceptance-manual-snapshot';
  override.retrievedAt = '2026-10-08T00:00:00.000Z';
  override.effectiveFrom = override.retrievedAt;
  override.rows[0].short.input += 1;
  await assert.rejects(router({ method: 'pricing/override', params: { policy: override, confirmed: false } }), /confirmation/);
  const saved = await router({ method: 'pricing/override', params: { policy: override, confirmed: true } });
  assert.equal(saved.saved, true);
  assert.equal(saved.snapshotId, override.id);
  assert.equal(saved.historicalSnapshotsPreserved, true);
  const after = await router({ method: 'pricing/snapshots' });
  assert.equal(after.length, before.length + 1);
  assert.deepEqual(after.find(policy => policy.id === original.id), original);
  assert.deepEqual(after.find(policy => policy.id === override.id), override);
  await observer.close(); observerClosed = true;
  const restarted = new ObservabilityClient({ database, codexHome: home });
  try {
    const restartedRouter = createRouter({ core: {}, store: {}, adapter: {}, observability: restarted });
    assert.deepEqual(await restartedRouter({ method: 'pricing/snapshots' }), after);
  } finally { await restarted.close(); }
});
