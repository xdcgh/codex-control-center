import { diagnosticsOverview } from './diagnostics.mjs';
import { validateAccountUsageParams } from '../observability/account-usage.mjs';
export function createRouter({core,store,adapter,observability,recorder,shutdown}) {
  const recordCatalog=count=>{if(Number.isSafeInteger(count)&&count>=0)store.setSetting('diagnostics:model-catalog',{observedAt:core.now(),count});};
  let accountActivity=null,accountRequest=null,accountKey=null,lastAccountReadAt=null;
  return async request=>{
    if(!request || typeof request.method!=='string')throw new Error('invalid-request');
    if(request.method==='snapshot')return core.snapshot();
    if(request.method==='account/activity/read'){
      const params=validateAccountUsageParams(request.params),key=JSON.stringify(params),now=core.now();
      if(accountActivity&&key===accountKey&&lastAccountReadAt!=null&&now-lastAccountReadAt<60000)return accountActivity;
      if(accountRequest){if(key!==accountKey)throw Error('Official account activity read is in progress');return accountRequest;}
      if(lastAccountReadAt!=null&&now-lastAccountReadAt<60000)throw Error('Wait 60 seconds before reading a different account activity scope');
      if(typeof adapter.readAccountUsage!=='function')throw Error('Official account activity is unavailable');
      accountKey=key;
      accountRequest=(async()=>{await adapter.connect();const result=await adapter.readAccountUsage(params);accountActivity=result;lastAccountReadAt=core.now();core.accountActivityObservation={fetchedAt:result.status==='Unavailable'?null:result.fetchedAt,status:result.status};return result;})();
      try{return await accountRequest;}finally{accountRequest=null;}
    }
    if(['diagnostics/overview','diagnostics/export'].includes(request.method))return diagnosticsOverview({core,store,adapter,observability});
    if(request.method==='settings/update')return core.setSettings(request.params??{});
    if(request.method==='thread/policy')return core.setThreadPolicy(request.params?.threadId,request.params?.update??{});
    if(request.method==='thread/resume')return core.resumeNow(request.params?.threadId);
    if(request.method==='quota/history')return store.queryQuotaHistory(request.params??{});
    if(request.method==='quota/chart')return store.queryQuotaChart(request.params??{});
    if(request.method==='natural/report'){if(!recorder)throw new Error('natural-recorder-unavailable');return recorder.report({...(request.params??{}),versions:{cliVersion:adapter.compatibility.cliVersion,desktopVersion:adapter.compatibility.desktopVersion}});}
    if(request.method==='events/list')return store.events();
    if(request.method==='doctor'){const report=await adapter.doctor(request.params??{});if(report.checks?.modelCatalog?.status==='passed')recordCatalog(report.checks.modelCatalog.result?.count);return report;}
    if(request.method==='database/backup'){if(!request.params?.destination)throw new Error('database-backup-destination-required');return store.backup(request.params.destination);}
    if(request.method==='database/acknowledge'){
      if(request.params?.confirmed!==true)throw new Error('database-recovery-confirmation-required');
      const report=await adapter.doctor({threadId:request.params?.threadId});
      if(!report.compatibility?.verified||['protocol','quota','modelCatalog'].some(name=>report.checks?.[name]?.status!=='passed'))throw new Error('database-recovery-doctor-not-verified');
      store.acknowledgeRecovery({confirmed:true});core.setSettings({autoResume:false});return{acknowledged:true,autoResume:false,doctor:report};
    }
    if(request.method==='models/list'){await adapter.connect();const models=await adapter.official.listModels();recordCatalog(models.length);return models;}
    const analytics={'analytics/summary':'summary','analytics/performance':'performance','analytics/quota-correlation':'correlation','pricing/snapshots':'pricing','pricing/check':'pricing-check','pricing/override':'pricing-override','analytics/diagnostics':'diagnostics','diagnostics/export':'export'};
    if(analytics[request.method]){if(!observability)throw new Error('observability-unavailable');return observability.call(analytics[request.method],request.params??{});}
    if(request.method==='refresh'){core.nextQuotaPollAt=0;core.nextScanAt=0;return core.tick();}
    if(request.method==='shutdown'){setImmediate(shutdown);return{stopping:true};}
    throw new Error('unknown-sidecar-method');
  };
}
