export function createRouter({core,store,adapter,observability,recorder,shutdown}) {
  return async request=>{
    if(!request || typeof request.method!=='string')throw new Error('invalid-request');
    if(request.method==='snapshot')return core.snapshot();
    if(request.method==='settings/update')return core.setSettings(request.params??{});
    if(request.method==='thread/policy')return core.setThreadPolicy(request.params?.threadId,request.params?.update??{});
    if(request.method==='thread/resume')return core.resumeNow(request.params?.threadId);
    if(request.method==='quota/history')return store.queryQuotaHistory(request.params??{});
    if(request.method==='quota/chart')return store.queryQuotaChart(request.params??{});
    if(request.method==='natural/report'){if(!recorder)throw new Error('natural-recorder-unavailable');return recorder.report({...(request.params??{}),versions:{cliVersion:adapter.compatibility.cliVersion,desktopVersion:adapter.compatibility.desktopVersion}});}
    if(request.method==='events/list')return store.events();
    if(request.method==='doctor')return adapter.doctor(request.params??{});
    if(request.method==='models/list'){await adapter.connect();return adapter.official.listModels();}
    const analytics={'analytics/summary':'summary','analytics/performance':'performance','analytics/quota-correlation':'correlation','pricing/snapshots':'pricing','analytics/diagnostics':'diagnostics','diagnostics/export':'export'};
    if(analytics[request.method]){if(!observability)throw new Error('observability-unavailable');return observability.call(analytics[request.method],request.params??{});}
    if(request.method==='refresh'){core.nextQuotaPollAt=0;core.nextScanAt=0;return core.tick();}
    if(request.method==='shutdown'){setImmediate(shutdown);return{stopping:true};}
    throw new Error('unknown-sidecar-method');
  };
}
