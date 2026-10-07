import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export const SCHEMA_VERSION=2;
const BASE_SCHEMA=`
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
      `;
function verify(db,{records=true}={}) {
  if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok') throw new Error('database-integrity-check-failed');
  if(records) for(const [table,column] of [['settings','value'],['threads','record_json'],['recovery_intents','intent_json'],['thread_policies','policy_json']]) {
    if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) throw new Error('database-required-table-missing');
    if(db.prepare(`SELECT 1 FROM ${table} WHERE NOT json_valid(${column}) LIMIT 1`).get()) throw new Error('database-record-corrupt');
  }
}
function checkLocalOwners(target) {
  for(const file of [path.join(path.dirname(target),'daemon.lock'),path.join(path.dirname(target),'broker','owner.json')]) {
    if(!fs.existsSync(file))continue;
    let owner;try{owner=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw new Error('database-recovery-owner-proof-invalid');}
    if(!Number.isSafeInteger(owner.pid)||owner.pid<=0)throw new Error('database-recovery-owner-proof-invalid');
    try{process.kill(owner.pid,0);throw new Error('database-recovery-live-owner');}catch(error){if(error.code!=='ESRCH')throw new Error('database-recovery-live-or-unverifiable-owner');}
  }
}
export class SqliteStore {
  static SCHEMA_VERSION=SCHEMA_VERSION;
  constructor(file,{now=Date.now,backupBeforeMigration=true}={}) {
    this.now=now;this.file=file;this.schemaVersion=SCHEMA_VERSION;
    if(file!==':memory:') fs.mkdirSync(path.dirname(file),{recursive:true});
    try {
      this.db=new DatabaseSync(file);this.db.exec('PRAGMA busy_timeout=3000;');
      const version=this.db.prepare('PRAGMA user_version').get().user_version;
      if(version>SCHEMA_VERSION) throw new Error('database-schema-newer-than-app');
      if(version===0&&this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1").get())throw new Error('database-unversioned-schema-unrecognized');
      verify(this.db,{records:version>=1});
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      if(version>0&&version<SCHEMA_VERSION&&file!==':memory:'&&backupBeforeMigration) {
        this.migrationBackup=file+`.pre-v${SCHEMA_VERSION}.${now()}.${randomUUID().slice(0,8)}.sqlite`;this.backup(this.migrationBackup);
      }
      this.transaction(()=>{
        let current=this.db.prepare('PRAGMA user_version').get().user_version;
        if(current>SCHEMA_VERSION) throw new Error('database-schema-newer-than-app');
        if(current===0) { this.db.exec(BASE_SCHEMA);this.db.exec('PRAGMA user_version=1;');current=1; }
        if(current===1) {
          this.db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at INTEGER NOT NULL);');
          this.db.exec('CREATE TABLE IF NOT EXISTS quota_history_aggregates(day INTEGER NOT NULL,limit_id TEXT NOT NULL,window INTEGER NOT NULL,reset_key TEXT NOT NULL,samples INTEGER NOT NULL,used_sum REAL NOT NULL,used_min REAL NOT NULL,used_max REAL NOT NULL,first_timestamp INTEGER NOT NULL,last_timestamp INTEGER NOT NULL,PRIMARY KEY(day,limit_id,window,reset_key));');
          const columns=this.db.prepare('PRAGMA table_info(quota_history_aggregates)').all().map(r=>r.name);
          for(const column of ['first_used_percent','last_used_percent']) if(!columns.includes(column)) this.db.exec(`ALTER TABLE quota_history_aggregates ADD COLUMN ${column} REAL;`);
          this.db.exec('CREATE TABLE IF NOT EXISTS quota_aggregate_keys(timestamp INTEGER NOT NULL,limit_id TEXT NOT NULL,window INTEGER NOT NULL,PRIMARY KEY(timestamp,limit_id,window)); CREATE INDEX IF NOT EXISTS quota_aggregate_time ON quota_history_aggregates(day); CREATE INDEX IF NOT EXISTS token_thread ON token_usage(thread_id,turn_id);');
          const legacy=this.db.prepare('SELECT count(*) n FROM quota_history_aggregates').get().n;
          if(legacy) { this.setSetting('history-legacy-aggregation',{quality:'Partial',reason:'legacy aggregate replay coverage is unverified'});this.db.exec(`INSERT OR IGNORE INTO quota_aggregate_keys SELECT q.timestamp,q.limit_id,q.window FROM quota_samples q JOIN quota_history_aggregates a ON a.limit_id=q.limit_id AND a.window=q.window AND a.reset_key=COALESCE(CAST(q.reset_at AS TEXT),'none') AND q.timestamp BETWEEN a.first_timestamp AND a.last_timestamp;`); }
          this.db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES(?,?)').run(1,now());this.db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES(?,?)').run(2,now());this.db.exec('PRAGMA user_version=2;');
        }
      });verify(this.db);
    } catch(error) { try{this.db?.close();}catch{};throw new Error(error.message.startsWith('database-')?error.message:'database-open-or-migration-failed'); }
  }
  migrationHistory() { return this.db.prepare('SELECT * FROM schema_migrations ORDER BY version').all(); }
  acknowledgeRecovery({confirmed=false}={}) {
    if(!confirmed)throw new Error('database-recovery-review-confirmation-required');
    const recovery=this.getSetting('database-recovery');
    if(!recovery?.requiresReview)return {reviewRequired:false};
    this.setSetting('database-recovery',{...recovery,requiresReview:false,reviewedAt:this.now()});
    return {reviewRequired:false,autoResume:false};
  }
  backup(destination) {
    if(typeof destination!=='string'||!destination||destination===':memory:'||fs.existsSync(destination)) throw new Error('database-backup-destination-invalid');
    fs.mkdirSync(path.dirname(destination),{recursive:true});this.db.prepare('VACUUM INTO ?').run(destination);
    const copy=new DatabaseSync(destination,{readOnly:true});try{verify(copy);return {created:true,integrity:'ok',schemaVersion:copy.prepare('PRAGMA user_version').get().user_version};}finally{copy.close();}
  }
  static recoverDatabase({file,backupFile,confirmed=false,quiescent=false,verifyOffline}={}) {
    if(!confirmed||!quiescent) throw new Error('database-recovery-confirmation-and-quiescence-required');
    if(typeof file!=='string'||typeof backupFile!=='string'||!fs.existsSync(file)||!fs.existsSync(backupFile)||path.resolve(file)===path.resolve(backupFile)) throw new Error('database-recovery-paths-invalid');
    const target=path.resolve(file),preservedDirectory=target+'.preserved-'+Date.now()+'-'+randomUUID().slice(0,8),candidate=target+'.restore-'+randomUUID()+'.sqlite';
    if(typeof verifyOffline!=='function')throw new Error('database-recovery-verified-offline-proof-required');
    const proof=verifyOffline(target);
    if(proof?.verified!==true||proof.activeOwners!==0||proof.database!==target)throw new Error('database-recovery-verified-offline-proof-required');
    checkLocalOwners(target);
    const source=new DatabaseSync(backupFile,{readOnly:true});
    try{verify(source);if(source.prepare('PRAGMA user_version').get().user_version>SCHEMA_VERSION)throw new Error('database-schema-newer-than-app');source.prepare('VACUUM INTO ?').run(candidate);}finally{source.close();}
    const restored=new SqliteStore(candidate,{backupBeforeMigration:false});
    try{restored.setSetting('core-settings',{...restored.getSetting('core-settings',{}),autoResume:false});restored.setSetting('database-recovery',{requiresReview:true,restoredAt:Date.now(),originalPreserved:true,ledgerCompleteness:'Unknown until reviewed against preserved original'});}finally{restored.close();}
    checkLocalOwners(target);fs.mkdirSync(preservedDirectory);const moved=[];
    try{for(const suffix of ['','-wal','-shm']) if(fs.existsSync(target+suffix)){const preserved=path.join(preservedDirectory,path.basename(target)+suffix);fs.renameSync(target+suffix,preserved);moved.push([target+suffix,preserved]);}fs.renameSync(candidate,target);}catch{for(const [original,preserved] of moved.reverse())if(!fs.existsSync(original)&&fs.existsSync(preserved))fs.renameSync(preserved,original);throw new Error('database-recovery-replacement-failed-original-preserved');}
    return {restored:true,preservedDirectory,originalPreserved:true,requiresReview:true,autoResume:false};
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
    const selected=this.db.prepare(`WITH range AS (SELECT rowid rid,* FROM quota_samples WHERE timestamp>=? AND timestamp<=?),
      ranked AS (SELECT rid,row_number() OVER(PARTITION BY limit_id,window,reset_at,CAST((timestamp-?)/? AS INTEGER) ORDER BY timestamp,rid) f,
      row_number() OVER(PARTITION BY limit_id,window,reset_at,CAST((timestamp-?)/? AS INTEGER) ORDER BY timestamp DESC,rid DESC) l,
      row_number() OVER(PARTITION BY limit_id,window,reset_at,CAST((timestamp-?)/? AS INTEGER) ORDER BY used_percent,timestamp,rid) lo,
      row_number() OVER(PARTITION BY limit_id,window,reset_at,CAST((timestamp-?)/? AS INTEGER) ORDER BY used_percent DESC,timestamp,rid) hi FROM range)
      SELECT * FROM quota_samples WHERE rowid IN (SELECT rid FROM ranked WHERE f=1 OR l=1 OR lo=1 OR hi=1) ORDER BY timestamp`).all(since,until,since,bucketMs,since,bucketMs,since,bucketMs,since,bucketMs);
    // Each reset segment keeps its first/last/extrema even when exceptional data exceeds the nominal target.
    const aggregates=this.queryQuotaAggregates({since,until});
    const daily=aggregates.map(a=>({timestamp:Math.max(since,Math.min(until,a.day+43200000)),limit_id:a.limit_id,window:a.window,used_percent:a.used_mean,remaining_percent:100-a.used_mean,reset_at:a.reset_key==='none'?null:Number(a.reset_key),source:'daily-aggregate',pointKind:'daily-mean',samples:a.samples,used_min:a.used_min,used_max:a.used_max,rangePartial:a.first_timestamp<since||a.last_timestamp>until}));
    const samples=[...selected,...daily].sort((a,b)=>a.timestamp-b.timestamp);
    return{samples,aggregates,hasAggregates:!!aggregates.length,sourceCount:sourceCount+aggregates.reduce((n,a)=>n+a.samples,0),sourceCountQuality:daily.some(a=>a.rangePartial)?'Partial: whole-day boundary aggregates':'Observed sample counts',downsampled:!!aggregates.length||selected.length<sourceCount,targetPointsPerWindow:maxPoints,bucketMs,
      exceedsTarget:samples.length>maxPoints*windows,quality:aggregates.length?'Recent representative observations plus labelled daily means; aggregate count/min/max retained':'Observed representative samples; reset segments are preserved'};
  }
  queryQuotaAggregates({since=0,until=this.now()}={}) {
    if(!Number.isFinite(since)||!Number.isFinite(until)||until<since)throw new Error('invalid-history-range');
    return this.db.prepare('SELECT * FROM quota_history_aggregates WHERE last_timestamp>=? AND first_timestamp<=? ORDER BY day,limit_id,window').all(since,until).map(r=>({...r,used_mean:r.samples?r.used_sum/r.samples:null,quality:this.getSetting('history-legacy-aggregation')?'Partial legacy aggregate':'Daily aggregate; not an individual observation'}));
  }
  maintainHistory(now=this.now(),{retentionDays=180}={}) {
    if(!Number.isFinite(now)||!Number.isInteger(retentionDays)||retentionDays<90||retentionDays>3650)throw new Error('invalid-history-retention');
    const dayMs=86400000,aggregateBefore=Math.floor((now-30*dayMs)/dayMs)*dayMs,retentionBefore=Math.floor((now-retentionDays*dayMs)/dayMs)*dayMs;
    return this.transaction(()=>{
      const rows=this.db.prepare('SELECT * FROM quota_samples WHERE timestamp<? ORDER BY timestamp').all(aggregateBefore),groups=new Map(),mark=this.db.prepare('INSERT OR IGNORE INTO quota_aggregate_keys VALUES(?,?,?)');
      for(const r of rows) {
        if(r.timestamp<retentionBefore||!mark.run(r.timestamp,r.limit_id,r.window).changes)continue;
        const day=Math.floor(r.timestamp/dayMs)*dayMs,reset=String(r.reset_at??'none'),key=JSON.stringify([day,r.limit_id,r.window,reset]);
        let g=groups.get(key);if(!g){g={day,id:r.limit_id,window:r.window,reset,n:0,sum:0,min:r.used_percent,max:r.used_percent,first:r.timestamp,last:r.timestamp,firstValue:r.used_percent,lastValue:r.used_percent};groups.set(key,g);}
        g.n++;g.sum+=r.used_percent;g.min=Math.min(g.min,r.used_percent);g.max=Math.max(g.max,r.used_percent);if(r.timestamp<g.first){g.first=r.timestamp;g.firstValue=r.used_percent;}if(r.timestamp>=g.last){g.last=r.timestamp;g.lastValue=r.used_percent;}
      }
      const insert=this.db.prepare(`INSERT INTO quota_history_aggregates(day,limit_id,window,reset_key,samples,used_sum,used_min,used_max,first_timestamp,last_timestamp,first_used_percent,last_used_percent) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(day,limit_id,window,reset_key) DO UPDATE SET samples=samples+excluded.samples,used_sum=used_sum+excluded.used_sum,used_min=min(used_min,excluded.used_min),used_max=max(used_max,excluded.used_max),first_used_percent=CASE WHEN excluded.first_timestamp<first_timestamp THEN excluded.first_used_percent ELSE first_used_percent END,last_used_percent=CASE WHEN excluded.last_timestamp>last_timestamp THEN excluded.last_used_percent ELSE last_used_percent END,first_timestamp=min(first_timestamp,excluded.first_timestamp),last_timestamp=max(last_timestamp,excluded.last_timestamp)`);
      for(const g of groups.values())insert.run(g.day,g.id,g.window,g.reset,g.n,g.sum,g.min,g.max,g.first,g.last,g.firstValue,g.lastValue);
      const aggregatedRemoved=this.db.prepare('DELETE FROM quota_samples WHERE timestamp<?').run(aggregateBefore).changes;
      const expiredAggregates=this.db.prepare('DELETE FROM quota_history_aggregates WHERE day<?').run(retentionBefore).changes;
      this.db.prepare('DELETE FROM quota_aggregate_keys WHERE timestamp<?').run(retentionBefore);this.setSetting('history-maintained-at',now);this.setSetting('history-retention',{retentionDays,rawDays:30,retentionBefore});
      return {aggregatedRemoved,expiredAggregates,aggregateBefore,retentionBefore,retentionDays,hourlyRemoved:aggregatedRemoved,dailyRemoved:0};
    });
  }
  compactHistory({ before, bucketMs = 3600000 }) {
    if (!Number.isFinite(before) || !Number.isSafeInteger(bucketMs) || bucketMs <= 0) throw new Error('invalid-downsampling-policy');
    return this.db.prepare(`WITH range AS (SELECT rowid rid,* FROM quota_samples WHERE timestamp<?),ranked AS (
      SELECT rid,row_number() OVER(PARTITION BY limit_id,window,reset_at,CAST(timestamp/? AS INTEGER) ORDER BY timestamp,rid) f,
      row_number() OVER(PARTITION BY limit_id,window,reset_at,CAST(timestamp/? AS INTEGER) ORDER BY timestamp DESC,rid DESC) l,
      row_number() OVER(PARTITION BY limit_id,window,reset_at,CAST(timestamp/? AS INTEGER) ORDER BY used_percent,timestamp,rid) lo,
      row_number() OVER(PARTITION BY limit_id,window,reset_at,CAST(timestamp/? AS INTEGER) ORDER BY used_percent DESC,timestamp,rid) hi FROM range)
      DELETE FROM quota_samples WHERE timestamp<? AND rowid NOT IN (SELECT rid FROM ranked WHERE f=1 OR l=1 OR lo=1 OR hi=1)`).run(before,bucketMs,bucketMs,bucketMs,bucketMs,before).changes;
  }
  close() { this.db.close(); }
}
