export function backfillAutomaticRecoveryEvents(recorder,store){
 const rows=store.db.prepare("SELECT id,timestamp,event,details_json FROM recovery_events WHERE event IN ('continuation-accepted','auto-resumed') ORDER BY id").all();
 const accepted=new Map();let restored=0;
 for(const row of rows){let details;try{details=JSON.parse(row.details_json);}catch{continue;}if(!details.threadId)continue;
  if(row.event==='continuation-accepted'){accepted.set(details.threadId,{turnId:details.turnId,timestamp:row.timestamp});continue;}
  const receipt=accepted.get(details.threadId);if(!receipt||row.timestamp<receipt.timestamp||row.timestamp-receipt.timestamp>60000)continue;
  const candidates=Object.values(recorder.state.cycles).filter(c=>c.threadId===details.threadId&&c.nextTurnId===receipt.turnId&&c.receipt&&c.receiptReal&&!c.syntheticEvidence&&c.autoResumedAt==null&&c.resumeAt!=null&&Math.abs(c.resumeAt-receipt.timestamp)<=5000);
  if(candidates.length!==1)continue;
  const cycle=candidates[0];recorder.onEngineEvent('auto-resumed',{threadId:cycle.threadId,failureTurnId:cycle.failureTurnId,observedAt:row.timestamp,source:'official-app-server'});
  store.event('natural-evidence-backfilled',{sourceEventId:row.id,evidenceTimestamp:row.timestamp});restored++;
 }
 return{restored};
}
