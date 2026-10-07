import { parentPort,workerData } from 'node:worker_threads';
import { SqliteStore } from '../persistence/sqlite.mjs';
import { ObservabilityService } from '../observability/index.mjs';
const store=new SqliteStore(workerData.database),service=new ObservabilityService({store,codexHome:workerData.codexHome});
let lastError=null;
const poll=()=>{try{service.poll();lastError=null;}catch{lastError='session-observation-unavailable';}};
poll();const timer=setInterval(poll,10000);
parentPort.on('message',({id,method,params})=>{
 try{
  if(method==='close'){clearInterval(timer);store.close();parentPort.close();return;}
  const methods={summary:'summary',performance:'performanceSummary',correlation:'quotaCorrelation',pricing:'pricingSnapshots',diagnostics:'diagnostics',export:'exportDiagnostics'};
  if(!methods[method])throw new Error('unknown-observability-method');
  const result=service[methods[method]](params??{});
  if(method==='diagnostics')result.lastError=lastError;
  parentPort.postMessage({id,result});
 }catch(error){parentPort.postMessage({id,error:{message:error.message}});}
});
