// Fixed-field diagnostic projection. Never copy event details, source paths,
// catalog records or raw Thread/Turn identities into the inventory.
const timestamp = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
export async function diagnosticsOverview({core,store,adapter,observability,diagnosticsTimeoutMs=1500}) {
  const now=core.now(), rows=[];
  const add=(label,source,observedAt,coverage,reason,interval=null)=>{
    const at=timestamp(observedAt);
    rows.push({label,source,observedAt:at,ageMs:at==null?null:Math.max(0,now-at),
      freshness:at==null?'Unavailable':at>now?'Unavailable':interval==null?'Observed':now-at>interval?'Stale':'Fresh',coverage,reason:at>now?'Recorded time is in the future':reason});
  };
  const compat=adapter.compatibility??{};
  const versions=Object.entries(compat.protocolVersion??{}).filter(([key,value])=>['initialize','thread-owner-discovery','thread-stream-state-changed','thread-stream-following-changed','thread-follower-start-turn'].includes(key)&&Number.isSafeInteger(value));
  add('Protocol version','Verified Desktop IPC',compat.checkedAt,versions.length?versions.map(([k,v])=>`${k}: ${v}`).join(' · '):'Unavailable',compat.verified?'Version and bundle verification passed':'Compatibility is not verified',120000);
  add('Compatibility','Version and bundle verification',compat.checkedAt,compat.verified?'Verified':'Read-only safe mode',compat.verified?'Version and bundle verification passed':'Unverified versions disable automatic writes',120000);
  add('Last quota poll','Official account/rateLimits/read',core.lastQuotaPollAt,core.quota?.known?'Observed':'Unavailable',core.quota?.known?'Reported windows only; missing windows remain unavailable':'Quota evidence is unavailable',core.settings.recoveryPollSeconds*2000);
  add('Model metadata source','Verified Desktop IPC',core.lastThreadObservationAt,'Partial','Observed current Thread metadata; actual served tier is unverified',core.settings.recoveryPollSeconds*2000);
  const catalog=store.getSetting('diagnostics:model-catalog',{});
  add('Model catalog','Official model/list',catalog.observedAt,Number.isSafeInteger(catalog.count)?String(catalog.count):'Unavailable','Catalog listing does not establish model entitlement');
  const lastEvent=store.db.prepare('SELECT timestamp,event FROM recovery_events ORDER BY timestamp DESC,id DESC LIMIT 1').get();
  const eventLabels={'auto-resumed':'Recovery acknowledgement recorded','continuation-accepted':'Continuation accepted','recovery-observed':'Recovery observed','task-state':'Task state recorded','connection-backoff':'Connection backoff','scheduler-error':'Scheduler error','thread-policy-updated':'Thread policy updated','resume-needs-attention':'Resume needs attention'};
  add('Last event','Local recovery event ledger',lastEvent?.timestamp,lastEvent?eventLabels[lastEvent.event]??'Recorded':'Unavailable','Event details and private identities are omitted');
  // Older receipts without the explicit manual=false marker cannot establish
  // that a resumption was automatic.
  const lastResume=store.db.prepare("SELECT MAX(timestamp) AS timestamp FROM recovery_events WHERE event='auto-resumed' AND json_extract(details_json,'$.manual')=0").get();
  add('Last auto resume','Acknowledged automatic recovery',lastResume.timestamp,lastResume.timestamp==null?'Unavailable':'Recorded','Acknowledgement does not establish task completion');
  const schema=store.db.prepare('PRAGMA user_version').get().user_version;
  add('Database','Local SQLite · WAL',null,String(schema),store.getSetting('database-recovery',{})?.requiresReview?'Database recovery review is required':'Schema version only; no new integrity check was run');
  let analytics=null;
  let timer;
  try { analytics=observability?await Promise.race([observability.call('diagnostics'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('source-unavailable')),diagnosticsTimeoutMs)})]):null; } catch { /* A failed source must not hide the remaining Core inventory. */ } finally {clearTimeout(timer);}
  add('Token source','SessionLogAdapter/v1',analytics?.lastPoll?.timestamp,analytics?.coverage?'Partial':'Unavailable',analytics?.lastError||analytics?.lastPoll?.errors>0?'Session indexing reported errors':'Response, cumulative delta and latest sample ledgers overlap; never add them together',30000);
  add('Pricing snapshot','Versioned API-equivalent pricing',analytics?.latestPricingRetrievedAt,Number.isSafeInteger(analytics?.pricingSnapshotCount)?String(analytics.pricingSnapshotCount):'Unavailable','Retrieval time is recorded policy evidence, not a new price check');
  add('Official account activity','Official account/usage/read',core.accountActivityObservation?.fetchedAt,['Observed','Partial'].includes(core.accountActivityObservation?.status)?core.accountActivityObservation.status:'Unavailable','Separate official account scope; never combine with local ledgers');
  const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
  const ledgers=['response','cumulative-delta','latest-sample','baseline-counter-inventory'];
  const coverage=Array.isArray(analytics?.coverage)?analytics.coverage.filter(row=>ledgers.includes(row.ledger)).map(row=>({ledger:row.ledger,records:count(row.records),missingTotalTokens:count(row.missingTotalTokens),missingModel:count(row.missingModel)})):null;
  return {schemaVersion:1,generatedAt:now,rows,coverage,limits:['Global and fork consumption are unverified','Model TTFT and decode speed are unavailable','Actual served tier is unverified'],privacy:'Safe aggregates only; no private identities, paths or event details'};
}
