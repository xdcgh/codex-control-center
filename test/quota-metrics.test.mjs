import test from 'node:test';import assert from 'node:assert/strict';
import { quotaMetrics } from '../ui/src/quota-metrics.mjs';
const hour=3600000,start=10*hour;
const sample=(timestamp,used,reset)=>({timestamp,window:300,used_percent:used,remaining_percent:100-used,reset_at:reset});
test('current-window average excludes the prior exhausted window plateau',()=>{
 const samples=[sample(start-4*hour,100,start),sample(start-1000,100,start),sample(start,0,start+5*hour),sample(start+.25*hour,20,start+5*hour),sample(start+.5*hour,40,start+5*hour)];
 const metrics=quotaMetrics(samples,300,start+.5*hour);assert.equal(metrics.currentAverage,80);assert.equal(metrics.recentRate,80);assert.equal(metrics.forecastAt,start+1.25*hour);assert.ok(metrics.selectedRangeBurn<20);
});
test('forecast does not project exhaustion across the next reported reset',()=>{
 const metrics=quotaMetrics([sample(start+4*hour,10,start+5*hour)],300,start+4*hour);assert.equal(metrics.currentAverage,2.5);assert.equal(metrics.resetFirst,true);assert.equal(metrics.forecastAt,null);
 assert.equal(quotaMetrics([sample(start+4*hour,10,start+5*hour)],300,start+6*hour).currentAverage,null);
});
