import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export class SqliteStore {
  constructor(file, { now = Date.now } = {}) {
    this.now = now;
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;');
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) { this.db.close(); throw new Error('database-schema-newer-than-app'); }
    this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS threads(thread_id TEXT PRIMARY KEY, record_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS recovery_intents(attempt_key TEXT PRIMARY KEY, intent_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS recovery_events(id INTEGER PRIMARY KEY, timestamp INTEGER NOT NULL, event TEXT NOT NULL, details_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS thread_policies(thread_id TEXT PRIMARY KEY, policy_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS quota_samples(timestamp INTEGER NOT NULL, limit_id TEXT NOT NULL, window INTEGER NOT NULL, used_percent REAL NOT NULL, remaining_percent REAL NOT NULL, reset_at INTEGER, credits_json TEXT, source TEXT NOT NULL, codex_version TEXT, PRIMARY KEY(timestamp,limit_id,window));
      CREATE INDEX IF NOT EXISTS quota_time ON quota_samples(timestamp);
      CREATE TABLE IF NOT EXISTS quota_history_aggregates(day INTEGER NOT NULL,limit_id TEXT NOT NULL,window INTEGER NOT NULL,reset_key TEXT NOT NULL,samples INTEGER NOT NULL,used_sum REAL NOT NULL,used_min REAL NOT NULL,used_max REAL NOT NULL,first_timestamp INTEGER NOT NULL,last_timestamp INTEGER NOT NULL,PRIMARY KEY(day,limit_id,window,reset_key));
      CREATE TABLE IF NOT EXISTS turns(turn_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, metadata_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS goals(thread_id TEXT PRIMARY KEY, metadata_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS token_usage(id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, turn_id TEXT, metadata_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS model_calls(id TEXT PRIMARY KEY, metadata_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS performance_samples(id TEXT PRIMARY KEY, metadata_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pricing_snapshots(id TEXT PRIMARY KEY, metadata_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS app_versions(id TEXT PRIMARY KEY, metadata_json TEXT NOT NULL);
      PRAGMA user_version=1; COMMIT;`);
    if (this.db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('database-integrity-check-failed');
  }
  transaction(action) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = action(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  load() {
    const meta = this.getSetting('engine', { schemaVersion: 1, startedAt: null });
    const records = Object.fromEntries(this.db.prepare('SELECT * FROM threads').all().map(r => [r.thread_id, JSON.parse(r.record_json)]));
    const ledger = Object.fromEntries(this.db.prepare('SELECT * FROM recovery_intents').all().map(r => [r.attempt_key, JSON.parse(r.intent_json)]));
    return { ...meta, records, ledger };
  }
  save(state) {
    this.transaction(() => {
      const { records, ledger, ...meta } = state;
      this.setSetting('engine', meta);
      const record = this.db.prepare('INSERT INTO threads VALUES(?,?) ON CONFLICT(thread_id) DO UPDATE SET record_json=excluded.record_json');
      for (const [id, value] of Object.entries(records)) record.run(id, JSON.stringify(value));
      const intent = this.db.prepare('INSERT INTO recovery_intents VALUES(?,?) ON CONFLICT(attempt_key) DO UPDATE SET intent_json=excluded.intent_json');
      for (const [key, value] of Object.entries(ledger)) intent.run(key, JSON.stringify(value));
    });
  }
  getSetting(key, fallback = null) { const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key); return row ? JSON.parse(row.value) : fallback; }
  setSetting(key, value) { this.db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }
  getThreadPolicy(id) { const row = this.db.prepare('SELECT policy_json FROM thread_policies WHERE thread_id=?').get(id); return row ? JSON.parse(row.policy_json) : {}; }
  setThreadPolicy(id, value) { this.db.prepare('INSERT INTO thread_policies VALUES(?,?) ON CONFLICT(thread_id) DO UPDATE SET policy_json=excluded.policy_json').run(id, JSON.stringify(value)); }
  event(event, details = {}) { this.db.prepare('INSERT INTO recovery_events(timestamp,event,details_json) VALUES(?,?,?)').run(this.now(), event, JSON.stringify(details)); }
  events(limit = 100) { return this.db.prepare('SELECT * FROM recovery_events ORDER BY id DESC LIMIT ?').all(limit).map(r => ({ id: r.id, timestamp: r.timestamp, event: r.event, details: JSON.parse(r.details_json) })); }
  sampleQuota(response, timestamp, source, codexVersion = null) {
    const buckets = response?.rateLimitsByLimitId ?? (response?.rateLimits ? { [response.rateLimits.limitId ?? 'codex']: response.rateLimits } : {});
    this.transaction(() => {
      const insert = this.db.prepare('INSERT OR IGNORE INTO quota_samples VALUES(?,?,?,?,?,?,?,?,?)');
      for (const [id, bucket] of Object.entries(buckets)) for (const window of [bucket.primary, bucket.secondary]) {
        if (!window || !Number.isFinite(window.usedPercent) || window.usedPercent < 0 || window.usedPercent > 100 || !Number.isFinite(window.windowDurationMins) || window.windowDurationMins <= 0) continue;
        insert.run(timestamp, id, window.windowDurationMins, window.usedPercent, 100-window.usedPercent, Number.isFinite(window.resetsAt) ? window.resetsAt*1000 : null, bucket.credits == null ? null : JSON.stringify(bucket.credits), source, codexVersion);
      }
    });
  }
  queryQuotaHistory({ since = 0, limit = 10000 } = {}) { return this.db.prepare('SELECT * FROM (SELECT * FROM quota_samples WHERE timestamp>=? ORDER BY timestamp DESC LIMIT ?) ORDER BY timestamp').all(since, Math.min(Math.max(limit, 1), 100000)); }
  queryQuotaChart({since=0,until=this.now(),maxPoints=2000}={}) {
    if(!Number.isFinite(since)||!Number.isFinite(until)||until<=since||!Number.isInteger(maxPoints)||maxPoints<16||maxPoints>10000)throw new Error('invalid-chart-range');
    const sourceCount=this.db.prepare('SELECT count(*) AS n FROM quota_samples WHERE timestamp>=? AND timestamp<=?').get(since,until).n;
    const resets=this.db.prepare('SELECT count(*) AS n FROM (SELECT DISTINCT limit_id,window,reset_at FROM quota_samples WHERE timestamp>=? AND timestamp<=?)').get(since,until).n;
    const windows=this.db.prepare('SELECT count(*) AS n FROM (SELECT DISTINCT limit_id,window FROM quota_samples WHERE timestamp>=? AND timestamp<=?)').get(since,until).n||1;
    const bucketMs=Math.max(1,Math.ceil((until-since)/Math.max(1,Math.floor((maxPoints*windows-resets*4)/4/windows))));
    const selected=this.db.prepare(`WITH range AS (SELECT rowid AS rid,* FROM quota_samples WHERE timestamp>=? AND timestamp<=?),
      points AS (SELECT min(rid) rid FROM range GROUP BY limit_id,window,reset_at,CAST((timestamp-?)/? AS INTEGER)
      UNION SELECT max(rid) FROM range GROUP BY limit_id,window,reset_at,CAST((timestamp-?)/? AS INTEGER)
      UNION SELECT rid FROM range GROUP BY limit_id,window,reset_at,CAST((timestamp-?)/? AS INTEGER) HAVING used_percent=min(used_percent)
      UNION SELECT rid FROM range GROUP BY limit_id,window,reset_at,CAST((timestamp-?)/? AS INTEGER) HAVING used_percent=max(used_percent))
      SELECT quota_samples.* FROM quota_samples WHERE rowid IN (SELECT rid FROM points) ORDER BY timestamp`).all(since,until,since,bucketMs,since,bucketMs,since,bucketMs,since,bucketMs);
    // Each reset segment keeps its first/last/extrema even when exceptional data exceeds the nominal target.
    return{samples:selected,sourceCount,downsampled:selected.length<sourceCount,targetPointsPerWindow:maxPoints,bucketMs,
      exceedsTarget:selected.length>maxPoints*windows,quality:'Observed representative samples; reset segments are preserved'};
  }
  maintainHistory(now=this.now()) {
    const dayMs=86400000,aggregateBefore=Math.floor((now-30*dayMs)/dayMs)*dayMs;
    this.transaction(()=>{
      this.db.prepare(`INSERT OR IGNORE INTO quota_history_aggregates SELECT CAST(timestamp/? AS INTEGER)*?,limit_id,window,COALESCE(CAST(reset_at AS TEXT),'none'),count(*),sum(used_percent),min(used_percent),max(used_percent),min(timestamp),max(timestamp) FROM quota_samples WHERE timestamp<? GROUP BY CAST(timestamp/? AS INTEGER),limit_id,window,reset_at`).run(dayMs,dayMs,aggregateBefore,dayMs);
    });
    const hourly=this.compactHistory({before:now-30*dayMs,bucketMs:3600000});
    const daily=this.compactHistory({before:now-90*dayMs,bucketMs:dayMs});
    this.setSetting('history-maintained-at',now);return{hourlyRemoved:hourly,dailyRemoved:daily,aggregateBefore};
  }
  compactHistory({ before, bucketMs = 3600000 }) {
    if (!Number.isFinite(before) || !Number.isSafeInteger(bucketMs) || bucketMs <= 0) throw new Error('invalid-downsampling-policy');
    // Preserve a representative first and last point and extrema in each bucket.
    return this.db.prepare(`DELETE FROM quota_samples WHERE timestamp<? AND rowid NOT IN (
      SELECT min(rowid) FROM quota_samples WHERE timestamp<? GROUP BY limit_id,window,reset_at,CAST(timestamp/? AS INTEGER)
      UNION SELECT max(rowid) FROM quota_samples WHERE timestamp<? GROUP BY limit_id,window,reset_at,CAST(timestamp/? AS INTEGER)
      UNION SELECT rowid FROM quota_samples WHERE timestamp<? GROUP BY limit_id,window,reset_at,CAST(timestamp/? AS INTEGER) HAVING used_percent=min(used_percent)
      UNION SELECT rowid FROM quota_samples WHERE timestamp<? GROUP BY limit_id,window,reset_at,CAST(timestamp/? AS INTEGER) HAVING used_percent=max(used_percent))`).run(before,before,bucketMs,before,bucketMs,before,bucketMs,before,bucketMs).changes;
  }
  close() { this.db.close(); }
}
