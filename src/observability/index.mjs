import { SessionLogAdapter, tokenFields } from './session-log-adapter.mjs';
import { PricingPolicy, normalizeServiceTier, digest } from './pricing.mjs';
export { SessionLogAdapter } from './session-log-adapter.mjs';
export { PricingPolicy, validatePricing, normalizeServiceTier } from './pricing.mjs';

export function percentile(values,p) { const v=values.filter(Number.isFinite).sort((a,b)=>a-b); return v.length?v[Math.max(0,Math.ceil(v.length*p)-1)]:null; }
export function distribution(values,total=values.length) { const v=values.filter(Number.isFinite);return {samples:v.length,missing:total-v.length,mean:v.length?v.reduce((a,b)=>a+b,0)/v.length:null,p50:percentile(v,.5),p95:percentile(v,.95),min:v.length?Math.min(...v):null,max:v.length?Math.max(...v):null}; }
export function unionDuration(intervals) {
  let total=0,start=null,end=null;
  for(const [a,b] of intervals.filter(([a,b])=>Number.isFinite(a)&&Number.isFinite(b)&&b>=a).sort((x,y)=>x[0]-y[0])) {
    if(start===null) { start=a;end=b; } else if(a<=end) end=Math.max(end,b); else { total+=end-start;start=a;end=b; }
  }
  return total+(start===null?0:end-start);
}
const windows={hour:3600000,day:86400000,'5h':18000000,week:604800000};
export class ObservabilityService {
  constructor({store,codexHome,now=Date.now,policy}={}) {
    if(!store?.db || !codexHome) throw new Error('observability-store-and-home-required');
    this.store=store;this.now=now;this.adapter=new SessionLogAdapter({store,codexHome,now});this.pricing=new PricingPolicy({store,policy});
  }
  poll() { return this.adapter.poll(); }
  observeTurnMetadata({threadId,turnId,model,provider,rawServiceTier,effort,collaborationMode,kind,goalId,modelContextWindow,turnStartedAtMs,turnCompletedAtMs,observedAt=this.now(),source}={}) {
    if(!['desktop-ipc','official-app-server'].includes(source)||typeof threadId!=='string'||typeof turnId!=='string'||!Number.isSafeInteger(observedAt)) throw new Error('invalid-observed-turn-metadata');
    const safe=v=>typeof v==='string'&&/^[a-zA-Z0-9._-]{1,128}$/.test(v)?v:null;
    const number=v=>Number.isSafeInteger(v)&&v>=0?v:null;
    const metadata={model:safe(model),provider:safe(provider),rawServiceTier:safe(rawServiceTier),effort:safe(effort),collaborationMode:safe(collaborationMode),kind:['goal','ordinary'].includes(kind)?kind:null,goalId:safe(goalId),modelContextWindow:number(modelContextWindow)>0?number(modelContextWindow):null,turnStartedAtMs:number(turnStartedAtMs),turnCompletedAtMs:number(turnCompletedAtMs),source};
    const key='observability:turn-metadata:'+digest([threadId,turnId]),history=this.store.getSetting(key,[]);
    if(JSON.stringify(history.at(-1)?.metadata)!==JSON.stringify(metadata)) { history.push({observedAt,metadata});this.store.setSetting(key,history); }
    return {recorded:true,source,scope:'exact-turn; only subsequent events are enriched'};
  }
  rows(table) { return this.store.db.prepare(`SELECT metadata_json FROM ${table}`).all().map(r=>JSON.parse(r.metadata_json)); }
  summary({since=0,groupBy='model'}={}) {
    const keys={model:'model',tier:'serviceTier',effort:'effort',collaboration:'collaborationMode',kind:'kind',turn:'turnId',thread:'threadId',goal:'goalId',workspace:'workspace'};
    if(!keys[groupBy] && !windows[groupBy]) throw new Error('unsupported-group-by');
    const groups=new Map();
    const all=this.rows('token_usage').filter(e=>e.timestamp>=since);
    const responseIdentities=new Set();let duplicateResponseRecords=0;
    // Expose separate sources; never silently add both ledgers.
    for(const e of all) {
      if(e.scope==='response'&&e.provider&&e.responseId) {
        const identity=JSON.stringify([e.provider,e.responseId]);
        if(responseIdentities.has(identity)) { duplicateResponseRecords++;continue; }
        responseIdentities.add(identity);
      }
      const inventory=e.initialCounter||e.discontinuity||e.outOfOrder||e.scope==='counter-snapshot';
      const unproven=inventory&&groupBy!=='thread';
      const key=unproven?'Counter inventory (unknown attribution)':windows[groupBy]?String(Math.floor(e.timestamp/windows[groupBy])*windows[groupBy]):groupBy==='tier'?normalizeServiceTier(e.rawServiceTier??e.serviceTier,e.provider)??'Unknown':e[keys[groupBy]]??'Unknown';
      const ledger=inventory?'baseline-counter-inventory':e.scope==='response'?'response':e.scope==='latest-sample'?'latest-sample':'cumulative-delta';
      const mapKey=JSON.stringify([key,ledger]);
      if(!groups.has(mapKey)) groups.set(mapKey,{key,ledger,samples:0,tokens:Object.fromEntries(tokenFields.map(k=>[k,0])),missing:Object.fromEntries(tokenFields.map(k=>[k,0])),inventoryValues:Object.fromEntries(tokenFields.map(k=>[k,[]])),estimatedUsd:0,pricedSamples:0,partialPriceSamples:0,pricingReasons:{},actualRequestInputs:[],latestSampleInputs:[],longContextSamples:0,unknownContextSamples:0,discontinuities:0});
      const g=groups.get(mapKey);g.samples++;g.discontinuities+=Number(e.discontinuity);
      g.turnTotals??=new Map();g.costValues??=[];g.contextWindows??=[];g.collaborationModeCounts??={};g.kindCounts??={};g.tierRequestCounts??={fast:0,standard:0,other:0,unknown:0};g.requestCount??=0;g.longContextRequests??=0;g.unknownRequestContext??=0;
      const kind=e.kind??'Unknown';g.kindCounts[kind]=(g.kindCounts[kind]??0)+1;
      const mode=e.collaborationMode??'Unknown';g.collaborationModeCounts[mode]=(g.collaborationModeCounts[mode]??0)+1;
      if(Number.isSafeInteger(e.modelContextWindow)&&e.modelContextWindow>0)g.contextWindows.push(e.modelContextWindow);
      if(!inventory&&e.turnId) {
        const identity=JSON.stringify([e.threadId,e.turnId]),turn=g.turnTotals.get(identity)??{total:0,missing:false};
        if(e.scope==='latest-sample'||e.usage.total_tokens==null)turn.missing=true;else turn.total+=e.usage.total_tokens;
        g.turnTotals.set(identity,turn);
      }
      for(const k of tokenFields) { if(e.usage[k]==null)g.missing[k]++;else if(inventory)g.inventoryValues[k].push(e.usage[k]);else g.tokens[k]+=e.usage[k]; }
      const request=e.latestUsage?{...e,usage:e.latestUsage,scope:'latest-sample'}:e;
      const price=inventory?{status:'Unavailable',usd:null,reason:'counter-inventory-is-not-additive-consumption'}:this.pricing.estimate(request);
      const context=inventory?{context:null}:this.pricing.context(request);
      if(price.status==='Partial') g.partialPriceSamples++;
      if(price.usd!=null) { g.estimatedUsd+=price.usd;g.pricedSamples++;g.costValues.push(price.usd); }
      if(price.reason) g.pricingReasons[price.reason]=(g.pricingReasons[price.reason]??0)+1;
      if(request.scope==='response' && request.responseId && request.usage.input_tokens!=null) g.actualRequestInputs.push(request.usage.input_tokens);
      if(request.scope==='latest-sample' && request.usage.input_tokens!=null) g.latestSampleInputs.push(request.usage.input_tokens);
      if(context.context==='long') g.longContextSamples++; else if(context.context==null) g.unknownContextSamples++;
      if(!inventory&&e.scope==='response'&&e.responseId&&e.provider) {
        g.requestCount++;const tier=normalizeServiceTier(e.rawServiceTier??e.serviceTier,e.provider);g.tierRequestCounts[tier==='fast'||tier==='standard'?tier:tier&&tier!=='auto'?'other':'unknown']++;
        if(context.context==='long')g.longContextRequests++;else if(context.context==null)g.unknownRequestContext++;
      }
    }
    return {groupBy,since,source:'local-session-log',duplicateResponseRecords,coverage:'Observed ledgers only; initial/reset/reordered counters are non-additive inventory. Known-provider response IDs are deduped across threads. Response, counter-delta and latest-sample ledgers overlap and must not be added together; global/root-child consumption is unverified.',groups:[...groups.values()].map(g=>{
      const inputs=g.actualRequestInputs;
      const snapshotsOnly=g.ledger==='latest-sample';
      const inventory=g.ledger==='baseline-counter-inventory';
      const counterInventoryStats=inventory?Object.fromEntries(tokenFields.map(k=>[k,{samples:g.inventoryValues[k].length,max:g.inventoryValues[k].length?Math.max(...g.inventoryValues[k]):null,p50:percentile(g.inventoryValues[k],.5),p95:percentile(g.inventoryValues[k],.95)}])):null;
      const statistics={observedTurns:inventory?null:g.turnTotals.size,requestCount:g.ledger==='response'&&g.requestCount===g.samples?g.requestCount:null,knownProviderRequestRecords:g.ledger==='response'?g.requestCount:null,requestCountQuality:'Unique known-provider response records only; missing response coverage is not inferred',turnTokenStatistics:inventory?null:{...distribution([...g.turnTotals.values()].filter(t=>!t.missing).map(t=>t.total),g.turnTotals.size),quality:'Observed contributions within this ledger; complete-turn consumption is unverified'},averageRequestInput:distribution(inputs).mean,longContextRequests:g.ledger==='response'?g.longContextRequests:null,unknownRequestContext:g.ledger==='response'?g.unknownRequestContext:null,tierRequestCounts:g.ledger==='response'?g.tierRequestCounts:null,tierCountQuality:'Observed metadata; configured turn tiers may not confirm actual served response tiers',configuredContextWindowStatistics:distribution(g.contextWindows,g.samples),estimatedCostStatistics:{...distribution(g.costValues,g.samples),quality:'API-equivalent estimates with per-sample coverage limits'},collaborationModeCounts:g.collaborationModeCounts};
      return {...g,...statistics,turnTotals:undefined,costValues:undefined,contextWindows:undefined,tokens:Object.fromEntries(tokenFields.map(k=>[k,snapshotsOnly||inventory||g.missing[k]===g.samples?null:g.tokens[k]])),inventoryValues:undefined,counterInventoryStats,additiveWithinLedger:!snapshotsOnly&&!inventory,canCombineWithOtherLedgers:false,globalConsumptionStatus:'Unavailable: inherited/delegated and overlapping ledger scopes not reconciled',actualRequestInputs:undefined,latestSampleInputs:undefined,countLabel:snapshotsOnly?'Usage samples':inventory?'Non-additive counter snapshots':g.ledger==='response'?'Response records':'Observed counter deltas',contextCountLabel:'Observed context samples; not a unique request count',tokenTotalStatus:inventory?'Non-additive counter inventory; not consumption':snapshotsOnly?'Unavailable: latest snapshots cannot establish an additive ledger':'Observed values within this ledger; global consumption unverified',inputP50:percentile(inputs,.5),inputP95:percentile(inputs,.95),inputSamples:inputs.length,latestSampleInputP50:percentile(g.latestSampleInputs,.5),latestSampleInputP95:percentile(g.latestSampleInputs,.95),latestInputObservations:g.latestSampleInputs.length,cacheHitRatio:snapshotsOnly||inventory||g.missing.cached_input_tokens||g.missing.input_tokens||g.tokens.input_tokens<=0||g.tokens.cached_input_tokens>g.tokens.input_tokens?null:g.tokens.cached_input_tokens/g.tokens.input_tokens,pricingStatus:snapshotsOnly?'Unavailable':g.pricedSamples===g.samples&&!g.partialPriceSamples?'Estimated':g.pricedSamples||g.partialPriceSamples?'Partial':'Unavailable',estimatedUsd:snapshotsOnly?null:g.pricedSamples?g.estimatedUsd:null};
    })};
  }
  performanceSummary({since=0}={}) {
    const samples=this.rows('performance_samples').filter(r=>r.timestamp>=since),usage=this.rows('token_usage'),byTurn=new Map(),responses=new Set();
    for(const u of usage) {
      if(u.initialCounter||u.discontinuity||u.outOfOrder||!['response','cumulative-delta'].includes(u.scope))continue;
      if(u.scope==='response'&&u.provider&&u.responseId){const key=JSON.stringify([u.provider,u.responseId]);if(responses.has(key))continue;responses.add(key);}
      const key=JSON.stringify([u.threadId,u.turnId]),entry=byTurn.get(key)??{response:[],counter:[]};entry[u.scope==='response'?'response':'counter'].push(u);byTurn.set(key,entry);
    }
    const unavailable={ttft:{status:'Unavailable',reason:'server-inference-start-and-first-sampled-token-not-exposed'},decode:{status:'Unavailable',reason:'exact-model-decode-duration-not-exposed'},modelWaiting:{status:'Unavailable',reason:'model-waiting-time-cannot-be-isolated-from-turn-wall-time'}};
    const labels={wall:'Observed turn wall time',firstVisible:'Observed first-visible-output latency',tool:'Observed tool wall time (overlap-safe)',effectiveThroughput:'Rough end-to-end output tokens/second'};
    const summarize=list=>{
      const metrics={wall:[],firstVisible:[],tool:[],effectiveThroughput:[]};let responseRecords=0;
      for(const sample of list) {
        if(Number.isFinite(sample.wallMs)&&sample.wallMs>=0)metrics.wall.push(sample.wallMs);
        if(sample.firstVisibleMs!=null&&sample.firstVisibleMs>=0)metrics.firstVisible.push(sample.firstVisibleMs);
        if(sample.toolsObserved&&!sample.missingToolEnds)metrics.tool.push(unionDuration(sample.toolIntervals.map(([a,b])=>[Math.max(a,sample.start),Math.min(b,sample.end)])));
        const entry=byTurn.get(JSON.stringify([sample.threadId,sample.turnId]));if(!entry)continue;responseRecords+=entry.response.length;
        const observed=entry.response.length?entry.response:entry.counter;
        if(observed.length&&observed.every(u=>u.usage.output_tokens!=null)&&sample.wallMs>0)metrics.effectiveThroughput.push(observed.reduce((n,u)=>n+u.usage.output_tokens,0)/(sample.wallMs/1000));
      }
      return {samples:list.length,responseRecords,metrics:Object.fromEntries(Object.entries(metrics).map(([key,v])=>[key,{label:labels[key],...distribution(v,list.length)}])),...unavailable};
    };
    const groups=new Map();
    for(const sample of samples) {
      const model=sample.model??'Unknown',provider=sample.provider??'Unknown',tier=normalizeServiceTier(sample.rawServiceTier??sample.serviceTier,sample.provider)??'Unknown',key=JSON.stringify([provider,model,tier]);
      if(!groups.has(key))groups.set(key,{model,provider,serviceTier:tier,rawServiceTiers:{},samples:[]});const group=groups.get(key),raw=sample.rawServiceTier??sample.serviceTier??'Unknown';group.rawServiceTiers[raw]=(group.rawServiceTiers[raw]??0)+1;group.samples.push(sample);
    }
    return {source:'local-session-log',clock:'recorded-wall-clock; system clock changes may affect observations',attribution:'Observed turn metadata; not isolated model performance. Response ledger preferred for rough throughput; otherwise counter deltas. Coverage remains incomplete.',...summarize(samples),groups:[...groups.values()].map(g=>({model:g.model,provider:g.provider,serviceTier:g.serviceTier,rawServiceTiers:g.rawServiceTiers,...summarize(g.samples)}))};
  }
  quotaCorrelation({since=0,bucketMs=3600000}={}) {
    if(!Number.isSafeInteger(bucketMs)||bucketMs<=0) throw new Error('invalid-correlation-bucket');
    const q=this.store.queryQuotaHistory({since}), buckets=new Map();
    for(const s of q) { const key=JSON.stringify([s.limit_id,s.window,Math.floor(s.timestamp/bucketMs)*bucketMs]);if(!buckets.has(key)) buckets.set(key,{limitId:s.limit_id,window:s.window,start:Math.floor(s.timestamp/bucketMs)*bucketMs,first:s.used_percent,last:s.used_percent,points:0});const b=buckets.get(key);b.last=s.used_percent;b.points++; }
    const usage=this.rows('token_usage').filter(u=>u.timestamp>=since&&u.scope==='cumulative-delta'&&!u.initialCounter&&!u.discontinuity&&!u.outOfOrder);
    const rows=[...buckets.values()].map(b=>{
      const samples=usage.filter(u=>u.timestamp>=b.start&&u.timestamp<b.start+bucketMs),missing=samples.filter(u=>u.usage.total_tokens==null).length;
      return {...b,usedPercentChange:b.points>1&&b.last>=b.first?b.last-b.first:null,tokenTotal:samples.length&&!missing?samples.reduce((n,u)=>n+u.usage.total_tokens,0):null,tokenSamples:samples.length,missingTokenSamples:missing,resetOrDiscontinuity:b.last<b.first};
    });
    const correlations=[];
    for(const identity of new Set(rows.map(r=>JSON.stringify([r.limitId,r.window])))) {
      const points=rows.filter(r=>JSON.stringify([r.limitId,r.window])===identity&&r.tokenTotal!=null&&r.usedPercentChange!=null),n=points.length;
      const mx=n?points.reduce((s,r)=>s+r.tokenTotal,0)/n:0,my=n?points.reduce((s,r)=>s+r.usedPercentChange,0)/n:0;
      const numerator=points.reduce((s,r)=>s+(r.tokenTotal-mx)*(r.usedPercentChange-my),0),denominator=Math.sqrt(points.reduce((s,r)=>s+(r.tokenTotal-mx)**2,0)*points.reduce((s,r)=>s+(r.usedPercentChange-my)**2,0));
      correlations.push({limitId:points[0]?.limitId??JSON.parse(identity)[0],window:JSON.parse(identity)[1],samples:n,pearson:n>=3&&denominator>0?numerator/denominator:null,status:n>=3&&denominator>0?'Estimated':'Unavailable',reason:n<3?'insufficient-aligned-samples':denominator===0?'no-variation':null});
    }
    return {confidence:'low',label:'Empirical co-occurrence; no official quota-token conversion or thread attribution',buckets:rows,correlations};
  }
  pricingSnapshots() { return this.pricing.snapshots(); }
  diagnostics() { return {adapter:'SessionLogAdapter/v1',source:'local sessions/archived_sessions',lastPoll:this.store.getSetting('observability:last-poll'),usageRecords:this.store.db.prepare('SELECT count(*) AS n FROM token_usage').get().n,performanceRecords:this.store.db.prepare('SELECT count(*) AS n FROM performance_samples').get().n,pricingSnapshotIds:this.pricingSnapshots().map(p=>p.id),privacy:'No prompts, messages, tool arguments, auth or complete sessions stored',databaseSchema:this.store.schemaVersion??this.store.db.prepare('PRAGMA user_version').get().user_version}; }
  exportDiagnostics() {
    const d=this.diagnostics();
    return {schemaVersion:1,adapter:d.adapter,source:d.source,lastPoll:d.lastPoll,usageRecords:d.usageRecords,performanceRecords:d.performanceRecords,pricingSnapshotCount:d.pricingSnapshotIds.length,databaseSchema:d.databaseSchema,privacy:d.privacy};
  }
}
