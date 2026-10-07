import fs from 'node:fs';
import path from 'node:path';
import { digest, normalizeServiceTier } from './pricing.mjs';

export const tokenFields = ['input_tokens','cached_input_tokens','cache_write_input_tokens','output_tokens','reasoning_output_tokens','total_tokens'];
export const tokens = value => Object.fromEntries(tokenFields.map(k => [k, Number.isSafeInteger(value?.[k]) && value[k] >= 0 ? value[k] : null]));
const scalar = v => typeof v === 'string' && v.length <= 512 ? v : null;
function files(root) {
  if (!fs.existsSync(root)) return [];
  const found = [];
  for (const item of fs.readdirSync(root,{withFileTypes:true})) {
    if (item.isSymbolicLink()) continue;
    const file = path.join(root,item.name);
    if (item.isDirectory()) found.push(...files(file));
    else if (item.isFile() && item.name.endsWith('.jsonl')) found.push(file);
  }
  return found.sort();
}
function insert(store, table, id, metadata, threadId, turnId) {
  if (table === 'token_usage') return store.db.prepare('INSERT OR IGNORE INTO token_usage VALUES(?,?,?,?)').run(id,threadId,turnId,JSON.stringify(metadata)).changes;
  return store.db.prepare(`INSERT OR REPLACE INTO ${table} VALUES(?,?)`).run(id,JSON.stringify(metadata)).changes;
}
export class SessionLogAdapter {
  constructor({store,codexHome,now=Date.now,maxReadBytes=8*1024*1024}) { this.store=store; this.codexHome=codexHome; this.now=now; this.maxReadBytes=maxReadBytes; }
  poll() {
    const result={files:0,records:0,usage:0,errors:0,discontinuities:0};
    for (const file of [...files(path.join(this.codexHome,'sessions')),...files(path.join(this.codexHome,'archived_sessions'))]) {
      try { this.read(file,result); } catch { result.errors++; }
    }
    this.store.setSetting('observability:last-poll',{timestamp:this.now(),...result}); return result;
  }
  read(file,result) {
    const key='observability:cursor:'+digest(file), stat=fs.statSync(file);
    let cursor=this.store.getSetting(key,{offset:0,meta:{},anchor:null});
    const fd=fs.openSync(file,'r');
    try {
      if (cursor.offset) {
        const size=Math.min(cursor.offset,128), b=Buffer.alloc(size); fs.readSync(fd,b,0,size,cursor.offset-size);
        if (stat.size<cursor.offset || digest(b.toString('hex'))!==cursor.anchor) { cursor={offset:0,meta:{},anchor:null}; result.discontinuities++; }
      }
      const buffer=Buffer.alloc(Math.min(this.maxReadBytes,Math.max(0,stat.size-cursor.offset)));
      fs.readSync(fd,buffer,0,buffer.length,cursor.offset);
      const end=buffer.lastIndexOf(10);
      if (end<0) { if(buffer.length===this.maxReadBytes) result.errors++; return; }
      const lines=buffer.subarray(0,end+1).toString('utf8').split('\n');
      this.store.transaction(()=>{
        for (const line of lines) {
          if (!line.trim()) continue;
          try { const event=JSON.parse(line); result.records++; this.consume(event,cursor.meta,result); } catch { result.errors++; }
        }
        cursor.offset+=end+1;
        const size=Math.min(cursor.offset,128), b=Buffer.alloc(size); fs.readSync(fd,b,0,size,cursor.offset-size); cursor.anchor=digest(b.toString('hex'));
        this.store.setSetting(key,cursor);
      }); result.files++;
    } finally { fs.closeSync(fd); }
  }
  consume(event,meta,result) {
    const p=event.payload ?? {}, timestamp=Date.parse(event.timestamp);
    if (event.type==='session_meta') { meta.threadId=scalar(p.id); meta.workspace=scalar(p.cwd); meta.provider=scalar(p.model_provider); return; }
    if (event.type==='turn_context') {
      meta.turnId=scalar(p.turn_id); meta.model=scalar(p.model); meta.effort=scalar(p.effort ?? p.reasoning_effort); meta.serviceTier=scalar(p.service_tier); meta.provider=scalar(p.model_provider) ?? meta.provider; meta.workspace=scalar(p.cwd) ?? meta.workspace; meta.goalId=scalar(p.goal_id);
      if(meta.threadId && meta.turnId) this.store.db.prepare('INSERT OR REPLACE INTO turns VALUES(?,?,?)').run(meta.turnId,meta.threadId,JSON.stringify({...meta,timestamp:Number.isFinite(timestamp)?timestamp:null})); return;
    }
    if (!meta.threadId || !Number.isFinite(timestamp)) return;
    const type=p.type ?? event.type;
    const turnId=scalar(p.turn_id)??meta.turnId??null;
    const history=this.store.getSetting('observability:turn-metadata:'+digest([meta.threadId,turnId]),[]);
    const observed=history.filter(m=>m.observedAt<=timestamp).at(-1)?.metadata;
    const provider=scalar(p.model_provider)??meta.provider??observed?.provider??null,loggedTier=scalar(p.service_tier)??meta.serviceTier??null,rawServiceTier=loggedTier??observed?.rawServiceTier??null;
    const base={threadId:meta.threadId,turnId,model:scalar(p.model)??meta.model??observed?.model??null,provider,rawServiceTier,serviceTier:normalizeServiceTier(rawServiceTier,provider),tierEvidence:loggedTier?'session-log-field':rawServiceTier?'observed-turn-settings':null,effort:meta.effort??observed?.effort??null,workspace:meta.workspace??null,goalId:meta.goalId??null,timestamp,source:'local-session-log'};
    if (type==='token_count' || type==='token_usage' || type==='token_usage_record') {
      const info=p.info ?? p, responseId=scalar(p.response_id ?? info.response_id), id=digest({thread:meta.threadId,responseId,event:responseId?null:event});
      if(this.store.db.prepare('SELECT 1 FROM token_usage WHERE id=?').get(id)) return;
      let usage, scope, latest=null, discontinuity=false, initialCounter=false;
      if (p.usage && responseId) { usage=tokens(p.usage); scope='response'; }
      else if (info.total_token_usage) {
        const current=tokens(info.total_token_usage), counterKey='observability:counter:'+digest(meta.threadId), old=this.store.getSetting(counterKey);
        initialCounter=!old;
        // A cumulative reset is a new epoch, never negative usage.
        discontinuity=!!old && tokenFields.some(k=>current[k]!=null && old[k]!=null && current[k]<old[k]);
        usage=Object.fromEntries(tokenFields.map(k=>[k,current[k]==null?null:old?.[k]==null||discontinuity?current[k]:current[k]-old[k]]));
        this.store.setSetting(counterKey,current); scope='cumulative-delta'; latest=info.last_token_usage?tokens(info.last_token_usage):null;
      } else if (info.last_token_usage) { usage=tokens(info.last_token_usage); scope='latest-sample'; }
      else return;
      if(discontinuity) result.discontinuities++;
      // Repeated cumulative snapshots are retained for provenance but cannot become
      // another billable/latest-request sample when no token counter advanced.
      const advanced=usage.input_tokens>0 || usage.output_tokens>0;
      const record={...base,usage,scope,responseId,latestUsage:advanced?latest:null,discontinuity,initialCounter,attribution:initialCounter?'initial-thread-counter; prior-turn-and-model-coverage-unproven':'observed-event-metadata',consistency:usage.total_tokens!=null && usage.input_tokens!=null && usage.output_tokens!=null && usage.total_tokens!==usage.input_tokens+usage.output_tokens?'total-mismatch':null};
      result.usage+=insert(this.store,'token_usage',id,record,meta.threadId,base.turnId);
      if(responseId) insert(this.store,'model_calls',id,record);
      return;
    }
    const turnKey='observability:timing:'+digest([meta.threadId,base.turnId]);
    let timing=this.store.getSetting(turnKey,{tools:{},intervals:[]});
    if (type==='task_started' || type==='turn_started') timing={start:timestamp,tools:{},intervals:[]};
    if (['agent_message','agent_message_delta','assistant_message'].includes(type) && timing.first==null) timing.first=timestamp;
    if (type==='tool_call_begin' && scalar(p.call_id)) { timing.tools[p.call_id]=timestamp;timing.toolsObserved=true; }
    if (type==='tool_call_end' && scalar(p.call_id) && timing.tools[p.call_id]!=null) { timing.intervals.push([timing.tools[p.call_id],timestamp]); delete timing.tools[p.call_id]; }
    if (['task_complete','turn_complete','turn_completed'].includes(type) && timing.start!=null && timestamp>=timing.start) {
      const sample={...base,start:timing.start,end:timestamp,wallMs:timestamp-timing.start,firstVisibleMs:timing.first>=timing.start?timing.first-timing.start:null,toolIntervals:timing.intervals,toolsObserved:!!timing.toolsObserved,missingToolEnds:Object.keys(timing.tools).length,label:'Observed local session event timing',clock:'recorded-wall-clock'};
      insert(this.store,'performance_samples',digest([meta.threadId,base.turnId,timing.start]),sample);
    }
    this.store.setSetting(turnKey,timing);
  }
}
