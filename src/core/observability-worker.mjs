import { parentPort,workerData } from 'node:worker_threads';
import { SqliteStore } from '../persistence/sqlite.mjs';
import { ObservabilityService } from '../observability/index.mjs';
const store=new SqliteStore(workerData.database),service=new ObservabilityService({store,codexHome:workerData.codexHome});
let lastError=null;
const poll=()=>{try{service.poll();lastError=null;}catch{lastError='session-observation-unavailable';}};
poll();const timer=setInterval(poll,10000);
parentPort.on('message',async({id,method,params})=>{
 try{
  if(method==='close'){clearInterval(timer);store.close();parentPort.close();return;}
  if(method==='pricing-check'){const result=await service.pricing.checkOfficialUpdate({fetchImpl:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(15000)})});store.setSetting('pricing:last-check',{...result,checkedAt:Date.now()});parentPort.postMessage({id,result});return;}
  if(method==='pricing-override'){service.pricing.manualOverride(params?.policy,{confirmed:params?.confirmed===true});parentPort.postMessage({id,result:{saved:true,snapshotId:params.policy.id,pricesModified:true,source:'manual-confirmed-policy',historicalSnapshotsPreserved:true}});return;}
  if(method==='observe-turn'){parentPort.postMessage({id,result:service.observeTurnMetadata(params??{})});return;}
  const methods={summary:'summary',performance:'performanceSummary',correlation:'quotaCorrelation',pricing:'pricingSnapshots',diagnostics:'diagnostics',export:'exportDiagnostics'};
  if(!methods[method])throw new Error('unknown-observability-method');
  const result=service[methods[method]](params??{});
  if(method==='diagnostics')result.lastError=lastError;
  parentPort.postMessage({id,result});
 }catch(error){parentPort.postMessage({id,error:{message:error.message}});}
});
