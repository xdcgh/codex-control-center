import { SessionLogAdapter, tokenFields } from './session-log-adapter.mjs';
import { PricingPolicy } from './pricing.mjs';
export { SessionLogAdapter } from './session-log-adapter.mjs';
export { PricingPolicy, validatePricing } from './pricing.mjs';

export function percentile(values,p) { const v=values.filter(Number.isFinite).sort((a,b)=>a-b); return v.length?v[Math.max(0,Math.ceil(v.length*p)-1)]:null; }
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
  rows(table) { return this.store.db.prepare(`SELECT metadata_json FROM ${table}`).all().map(r=>JSON.parse(r.metadata_json)); }
  summary({since=0,groupBy='model'}={}) {
    const keys={model:'model',tier:'serviceTier',effort:'effort',turn:'turnId',thread:'threadId',goal:'goalId',workspace:'workspace'};
    if(!keys[groupBy] && !windows[groupBy]) throw new Error('unsupported-group-by');
    const groups=new Map();
    const all=this.rows('token_usage').filter(e=>e.timestamp>=since);
    // Expose separate sources; never silently add both ledgers.
    for(const e of all) {
      const unproven=e.initialCounter && groupBy!=='thread';
      const key=unproven?'Unknown (initial thread counter)':windows[groupBy]?String(Math.floor(e.timestamp/windows[groupBy])*windows[groupBy]):e[keys[groupBy]]??'Unknown';
      const ledger=e.scope==='response'?'response':e.scope==='latest-sample'?'latest-sample':'cumulative-delta';
      const mapKey=JSON.stringify([key,ledger]);
      if(!groups.has(mapKey)) groups.set(mapKey,{key,ledger,samples:0,tokens:Object.fromEntries(tokenFields.map(k=>[k,0])),missing:Object.fromEntries(tokenFields.map(k=>[k,0])),estimatedUsd:0,pricedSamples:0,partialPriceSamples:0,pricingReasons:{},actualRequestInputs:[],latestSampleInputs:[],longContextSamples:0,unknownContextSamples:0,discontinuities:0});
      const g=groups.get(mapKey);g.samples++;g.discontinuities+=Number(e.discontinuity);
      for(const k of tokenFields) e.usage[k]==null?g.missing[k]++:g.tokens[k]+=e.usage[k];
      const request=e.latestUsage?{...e,usage:e.latestUsage,scope:'latest-sample'}:e;
      const price=this.pricing.estimate(request);
      if(price.status==='Partial') g.partialPriceSamples++;
      if(price.usd!=null) { g.estimatedUsd+=price.usd;g.pricedSamples++; }
      if(price.reason) g.pricingReasons[price.reason]=(g.pricingReasons[price.reason]??0)+1;
      if(request.scope==='response' && request.responseId && request.usage.input_tokens!=null) g.actualRequestInputs.push(request.usage.input_tokens);
      if(request.scope==='latest-sample' && request.usage.input_tokens!=null) g.latestSampleInputs.push(request.usage.input_tokens);
      if(price.context==='long') g.longContextSamples++; else if(price.context==null) g.unknownContextSamples++;
    }
    return {groupBy,since,source:'local-session-log',coverage:'best-effort; response and cumulative ledgers are separate and must not be added together',groups:[...groups.values()].map(g=>{
      const inputs=g.actualRequestInputs;
      const snapshotsOnly=g.ledger==='latest-sample';
      return {...g,tokens:snapshotsOnly?Object.fromEntries(tokenFields.map(k=>[k,null])):g.tokens,actualRequestInputs:undefined,latestSampleInputs:undefined,countLabel:g.ledger==='response'?'Response records':'Usage samples',contextCountLabel:'Observed context samples; not a unique request count',tokenTotalStatus:snapshotsOnly?'Unavailable: latest snapshots cannot establish an additive ledger':'Best-effort',inputP50:percentile(inputs,.5),inputP95:percentile(inputs,.95),inputSamples:inputs.length,latestSampleInputP50:percentile(g.latestSampleInputs,.5),latestSampleInputP95:percentile(g.latestSampleInputs,.95),latestInputObservations:g.latestSampleInputs.length,cacheHitRatio:snapshotsOnly||g.missing.cached_input_tokens||g.missing.input_tokens?null:g.tokens.input_tokens?g.tokens.cached_input_tokens/g.tokens.input_tokens:0,pricingStatus:snapshotsOnly?'Unavailable':g.pricedSamples===g.samples&&!g.partialPriceSamples?'Estimated':g.pricedSamples?'Partial':'Unavailable',estimatedUsd:snapshotsOnly?null:g.pricedSamples?g.estimatedUsd:null};
    })};
  }
  performanceSummary({since=0}={}) {
    const samples=this.rows('performance_samples').filter(r=>r.timestamp>=since), usage=this.rows('token_usage');
    const metrics={wall:[],firstVisible:[],tool:[],effectiveThroughput:[]};
    for(const s of samples) {
      metrics.wall.push(s.wallMs);if(s.firstVisibleMs!=null) metrics.firstVisible.push(s.firstVisibleMs);
      if(s.toolsObserved && !s.missingToolEnds) metrics.tool.push(unionDuration(s.toolIntervals.map(([a,b])=>[Math.max(a,s.start),Math.min(b,s.end)])));
      const entries=usage.filter(u=>u.threadId===s.threadId&&u.turnId===s.turnId&&u.scope==='cumulative-delta'&&!u.initialCounter);
      if(entries.length && entries.every(u=>u.usage.output_tokens!=null) && s.wallMs>0) metrics.effectiveThroughput.push(entries.reduce((n,u)=>n+u.usage.output_tokens,0)/(s.wallMs/1000));
    }
    const labels={wall:'Observed turn wall time',firstVisible:'Observed first-visible-output latency',tool:'Observed tool wall time (overlap-safe)',effectiveThroughput:'Rough end-to-end output tokens/second'};
    return {source:'local-session-log',clock:'recorded-wall-clock; system clock changes may affect observations',samples:samples.length,metrics:Object.fromEntries(Object.entries(metrics).map(([k,v])=>[k,{label:labels[k],p50:percentile(v,.5),p95:percentile(v,.95),samples:v.length,missing:samples.length-v.length}])),ttft:{status:'Unavailable',reason:'server-inference-start-and-first-sampled-token-not-exposed'},decode:{status:'Unavailable',reason:'exact-model-decode-duration-not-exposed'}};
  }
  quotaCorrelation({since=0,bucketMs=3600000}={}) {
    if(!Number.isSafeInteger(bucketMs)||bucketMs<=0) throw new Error('invalid-correlation-bucket');
    const q=this.store.queryQuotaHistory({since}), buckets=new Map();
    for(const s of q) { const key=JSON.stringify([s.limit_id,s.window,Math.floor(s.timestamp/bucketMs)*bucketMs]);if(!buckets.has(key)) buckets.set(key,{limitId:s.limit_id,window:s.window,start:Math.floor(s.timestamp/bucketMs)*bucketMs,first:s.used_percent,last:s.used_percent,points:0});const b=buckets.get(key);b.last=s.used_percent;b.points++; }
    const usage=this.rows('token_usage').filter(u=>u.timestamp>=since&&u.scope==='cumulative-delta'&&!u.initialCounter);
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
  diagnostics() { return {adapter:'SessionLogAdapter/v1',source:'local sessions/archived_sessions',lastPoll:this.store.getSetting('observability:last-poll'),usageRecords:this.store.db.prepare('SELECT count(*) AS n FROM token_usage').get().n,performanceRecords:this.store.db.prepare('SELECT count(*) AS n FROM performance_samples').get().n,pricingSnapshotIds:this.pricingSnapshots().map(p=>p.id),privacy:'No prompts, messages, tool arguments, auth or complete sessions stored',databaseSchema:1}; }
  exportDiagnostics() {
    const d=this.diagnostics();
    return {schemaVersion:1,adapter:d.adapter,source:d.source,lastPoll:d.lastPoll,usageRecords:d.usageRecords,performanceRecords:d.performanceRecords,pricingSnapshotCount:d.pricingSnapshotIds.length,databaseSchema:d.databaseSchema,privacy:d.privacy};
  }
}
