export function quotaMetrics(samples,durationMinutes,now=Date.now()){
 const series=samples.filter(s=>s.window===durationMinutes).sort((a,b)=>a.timestamp-b.timestamp),latest=series.at(-1);
 let burn=0,span=0;for(let i=1;i<series.length;i++){const a=series[i-1],b=series[i];if(a.reset_at===b.reset_at&&b.used_percent>=a.used_percent){burn+=b.used_percent-a.used_percent;span+=b.timestamp-a.timestamp;}}
 const selectedRangeBurn=span>0?burn/span*3600000:null;
 if(!latest||!Number.isFinite(latest.reset_at)||latest.reset_at<=now)return{latest,currentAverage:null,recentRate:null,selectedRangeBurn,forecastAt:null,resetFirst:false};
 const start=latest.reset_at-durationMinutes*60000,elapsed=latest.timestamp-start;
 const currentAverage=elapsed>0&&latest.used_percent>=0?latest.used_percent/elapsed*3600000:null;
 const current=series.filter(s=>s.reset_at===latest.reset_at&&s.timestamp>=Math.max(start,latest.timestamp-15*60000)),first=current[0];
 const recentRate=first&&latest.timestamp>first.timestamp&&latest.used_percent>=first.used_percent?(latest.used_percent-first.used_percent)/(latest.timestamp-first.timestamp)*3600000:null;
 const rate=recentRate??currentAverage;
 const projected=rate>0?latest.timestamp+latest.remaining_percent/rate*3600000:null;
 const resetFirst=rate===0||(projected!=null&&projected>=latest.reset_at);
 return{latest,currentAverage,recentRate,selectedRangeBurn,forecastAt:resetFirst?null:projected,resetFirst};
}
