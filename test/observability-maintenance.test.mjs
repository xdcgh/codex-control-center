import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {SqliteStore,SCHEMA_VERSION} from '../src/persistence/sqlite.mjs';
const DAY=86400000,NOW=200*DAY,hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function fixture(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ccc-maintenance-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return {directory,file:path.join(directory,'store.sqlite')};}
const sample=(s,time,percent,reset=999999)=>s.sampleQuota({rateLimits:{primary:{usedPercent:percent,windowDurationMins:300,resetsAt:reset}}},time,'fixture');
test('v1 forward migration preserves durable intents and backs up current WAL content',t=>{
  const {file}=fixture(t);let s=new SqliteStore(file);s.save({schemaVersion:1,records:{thread:{phase:'waitingQuota'}},ledger:{incident:{phase:'uncertain',messageId:'fixture'}}});s.close();
  const old=new DatabaseSync(file);old.exec('PRAGMA journal_mode=WAL; PRAGMA user_version=1; DROP TABLE schema_migrations; DROP TABLE quota_aggregate_keys; ALTER TABLE quota_history_aggregates DROP COLUMN first_used_percent; ALTER TABLE quota_history_aggregates DROP COLUMN last_used_percent;');old.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)').run('wal-receipt',JSON.stringify({observed:true}));
  s=new SqliteStore(file);assert.equal(s.schemaVersion,SCHEMA_VERSION);assert.equal(s.load().ledger.incident.phase,'uncertain');assert.ok(fs.existsSync(s.migrationBackup));assert.deepEqual(s.migrationHistory().map(r=>r.version),[1,2]);
  const backup=new DatabaseSync(s.migrationBackup,{readOnly:true});assert.equal(JSON.parse(backup.prepare("SELECT value FROM settings WHERE key='wal-receipt'").get().value).observed,true);assert.equal(backup.prepare('PRAGMA user_version').get().user_version,1);backup.close();s.close();old.close();
});
test('corruption and newer schema fail closed; explicit restore preserves the original and disables auto resume',t=>{
  const {file,directory}=fixture(t);let s=new SqliteStore(file);s.save({schemaVersion:1,records:{},ledger:{incident:{phase:'uncertain'}}});s.setSetting('core-settings',{autoResume:true});const backup=path.join(directory,'good.sqlite');s.backup(backup);s.close();
  fs.writeFileSync(file,'corrupt original fixture bytes');const before=hash(file);assert.throws(()=>new SqliteStore(file),/database-/);assert.equal(hash(file),before);assert.throws(()=>SqliteStore.recoverDatabase({file,backupFile:backup}),/confirmation/);
  const receipt=SqliteStore.recoverDatabase({file,backupFile:backup,confirmed:true,quiescent:true,verifyOffline:database=>({database,verified:true,activeOwners:0})});assert.equal(hash(path.join(receipt.preservedDirectory,path.basename(file))),before);s=new SqliteStore(file);assert.equal(s.load().ledger.incident.phase,'uncertain');assert.equal(s.getSetting('core-settings').autoResume,false);assert.equal(s.getSetting('database-recovery').requiresReview,true);s.close();
  const future=new DatabaseSync(file);future.exec('PRAGMA user_version=99');future.close();const newer=hash(file);assert.throws(()=>new SqliteStore(file),/schema-newer/);assert.equal(hash(file),newer);
});
test('malformed recovery ledger JSON is not silently rebuilt',t=>{
  const {file}=fixture(t);const s=new SqliteStore(file);s.db.prepare('INSERT INTO recovery_intents VALUES(?,?)').run('incident','{broken');s.close();assert.throws(()=>new SqliteStore(file),/database-record-corrupt/);
});
test('an unversioned populated SQLite file is not silently treated as a fresh empty recovery ledger',t=>{
  const {file}=fixture(t);const db=new DatabaseSync(file);db.exec('CREATE TABLE legacy_state(value TEXT); INSERT INTO legacy_state VALUES(\'fixture\');');db.close();const original=hash(file);assert.throws(()=>new SqliteStore(file),/unversioned-schema/);assert.equal(hash(file),original);
});
test('compaction preserves timestamp first/last and extrema separately for reset segments despite unordered inserts',t=>{
  const s=new SqliteStore(':memory:');t.after(()=>s.close());for(const [time,p] of [[400,30],[100,50],[300,90],[200,10],[350,40]])sample(s,time,p,999);for(const [time,p] of [[450,0],[470,20],[460,10]])sample(s,time,p,1999);
  s.compactHistory({before:1000,bucketMs:1000});const values=s.queryQuotaHistory();assert.deepEqual(values.filter(r=>r.reset_at===999000).map(r=>r.timestamp),[100,200,300,400]);assert.equal(values.filter(r=>r.reset_at===1999000).length,2);
});
test('daily aggregates retain exact count/mean/extrema with replay dedupe, bounded history, and 90-day chart continuity after restart',t=>{
  const {file}=fixture(t);let s=new SqliteStore(file,{now:()=>NOW});const day=NOW-40*DAY;for(const [offset,p] of [[100,30],[200,10],[300,90],[400,50]])sample(s,day+offset,p);sample(s,NOW-190*DAY,5);sample(s,NOW-10*DAY,70);
  s.maintainHistory(NOW);let a=s.queryQuotaAggregates({since:NOW-90*DAY,until:NOW});assert.equal(a.length,1);assert.equal(a[0].samples,4);assert.equal(a[0].used_mean,45);assert.equal(a[0].used_min,10);assert.equal(a[0].used_max,90);assert.equal(a[0].first_used_percent,30);assert.equal(a[0].last_used_percent,50);
  sample(s,day+200,10);sample(s,day+500,20);s.maintainHistory(NOW);a=s.queryQuotaAggregates({since:NOW-90*DAY,until:NOW});assert.equal(a[0].samples,5);assert.equal(a[0].used_mean,40);s.close();s=new SqliteStore(file,{now:()=>NOW});const chart=s.queryQuotaChart({since:NOW-90*DAY,until:NOW});assert.ok(chart.hasAggregates);assert.ok(chart.samples.some(r=>r.pointKind==='daily-mean'&&r.samples===5));assert.ok(chart.samples.some(r=>r.source==='fixture'));assert.equal(chart.sourceCount,6);s.maintainHistory(NOW+200*DAY);assert.equal(s.queryQuotaAggregates({since:0,until:NOW+200*DAY}).length,0);s.close();
});
