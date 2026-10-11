import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { transformWithOxc } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

function withExplicitExtension(source, moduleName) {
  return source.replaceAll(`'./${moduleName}'`, `'./${moduleName}.mjs'`)
    .replaceAll(`"./${moduleName}"`, `"./${moduleName}.mjs"`);
}

async function loadComponent() {
  fs.mkdirSync(path.resolve('node_modules/.cache'), { recursive: true });
  const dir = fs.mkdtempSync(path.resolve('node_modules/.cache/render-regression-'));
  const compile = async (sourcePath, outputName) => {
    const source = fs.readFileSync(sourcePath, 'utf8');
    const result = await transformWithOxc(source, outputName, { jsx: { runtime: 'automatic' } });
    return result.code;
  };
  const core = await compile('ui/src/i18n-core.ts', 'i18n-core.ts');
  const i18n = withExplicitExtension(await compile('ui/src/i18n.ts', 'i18n.ts'), 'i18n-core');
  const component = withExplicitExtension(withExplicitExtension(await compile('ui/src/StatisticsComparison.tsx', 'StatisticsComparison.tsx'), 'i18n'), 'i18n-core');
  const thread = withExplicitExtension(withExplicitExtension(await compile('ui/src/ThreadDetails.tsx', 'ThreadDetails.tsx'), 'i18n'), 'i18n-core');
  fs.writeFileSync(path.join(dir, 'i18n-core.mjs'), core);
  fs.writeFileSync(path.join(dir, 'i18n.mjs'), i18n);
  fs.writeFileSync(path.join(dir, 'comparison.mjs'), component);
  fs.writeFileSync(path.join(dir, 'thread.mjs'), thread);
  const runtime = withExplicitExtension(await compile('ui/src/RuntimeDiagnostics.tsx', 'RuntimeDiagnostics.tsx'), 'i18n');
  fs.writeFileSync(path.join(dir, 'runtime.mjs'), runtime);
  const account = withExplicitExtension(await compile('ui/src/AccountActivity.tsx', 'AccountActivity.tsx'), 'i18n');
  fs.writeFileSync(path.join(dir, 'account.mjs'), account);
  return {
    module: await import(pathToFileURL(path.join(dir, 'comparison.mjs'))),
    thread: await import(pathToFileURL(path.join(dir, 'thread.mjs'))),
    runtime: await import(pathToFileURL(path.join(dir, 'runtime.mjs'))),
    account: await import(pathToFileURL(path.join(dir, 'account.mjs'))),
    i18n: await import(pathToFileURL(path.join(dir, 'i18n.mjs'))),
    close: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

const fixtureData = {
  groups: [
    {
      provider: 'provider-one', model: 'test-model', serviceTier: 'Unknown', rawServiceTiers: { Unknown: 10 },
      metrics: { wall: { label: 'Observed turn wall time', mean: null, p50: null, p95: null, min: null, max: null, samples: 0, missing: 10 } },
    },
    { model: 'test-model', provider: 'provider-two', rawServiceTiers: [], metrics: {} },
    { model: 'missing-metrics', rawServiceTiers: [] },
  ],
};

test('performance renderer preserves production tier maps and unavailable values in English and Chinese', async () => {
  const fixture = await loadComponent();
  try {
    fixture.i18n.setLocalePreferences({ language: 'en' });
    const english = renderToStaticMarkup(React.createElement(fixture.module.PerformanceComparison, { data: fixtureData }));
    assert.match(english, /Unknown: 10/);
    assert.match(english, /provider-one \/ test-model/);
    assert.match(english, /provider-two \/ test-model/);
    assert.match(english, /Unknown provider/);
    assert.match(english, /Unavailable: no metric observations/);
    assert.match(english, /Observed turn wall time/);

    fixture.i18n.setLocalePreferences({ language: 'zh-CN' });
    const chinese = renderToStaticMarkup(React.createElement(fixture.module.PerformanceComparison, { data: fixtureData }));
    assert.match(chinese, /按模型与档位统计的观测轮次性能/);
    assert.match(chinese, /不可用：暂无指标观测/);
    assert.match(chinese, /观测轮次总耗时/);
    assert.match(chinese, /未知提供方/);
    assert.match(chinese, /provider-one \/ test-model/);
    assert.match(chinese, /provider-two \/ test-model/);
    assert.match(chinese, /未知: 10/);

    assert.doesNotThrow(() => renderToStaticMarkup(React.createElement(fixture.module.PerformanceComparison, { data: { groups: [] } })));
    assert.doesNotThrow(() => renderToStaticMarkup(React.createElement(fixture.module.PerformanceComparison, { data: null })));
  } finally {
    fixture.close();
  }
});

test('statistics renderer localizes quality labels but leaves dynamic model IDs and ledger data intact', async () => {
  const fixture = await loadComponent();
  const props = {
    privacy: false,
    groupBy: 'model',
    groups: [{ key: 'test-model', ledger: 'response', requestCount: null, requestCountQuality: 'Unavailable', averageRequestInput: 125, inputP50: 100, inputP95: 250, cacheHitRatio: 0.25, tokens: {}, tierRequestCounts: { unknown: 3 } }],
  };
  try {
    fixture.i18n.setLocalePreferences({ language: 'en' });
    const english = renderToStaticMarkup(React.createElement(fixture.module.StatisticsComparison, props));
    assert.match(english, /test-model/);
    assert.doesNotMatch(english, /&quot;test-model&quot;/);
    assert.match(english, /Unavailable/);
    assert.match(english, /Unknown: 3/);
    assert.match(english, /125 \/ 100 \/ 250/);
    assert.match(english, /25%/);

    fixture.i18n.setLocalePreferences({ language: 'zh-CN' });
    const chinese = renderToStaticMarkup(React.createElement(fixture.module.StatisticsComparison, props));
    assert.match(chinese, /模型、档位与上下文对比/);
    assert.match(chinese, /不可用/);
    assert.match(chinese, /test-model/);
    assert.match(chinese, /未知: 3/);
  } finally {
    fixture.close();
  }
});

test('ThreadDetails renders known metadata in both languages while unknown values and flags stay exact', async () => {
  const fixture = await loadComponent();
  const task = {threadId:'fixture-thread',phase:'watching',currentTurnStatus:'inProgress',collaborationMode:'default',runtimeType:'active',runtimeFlags:['default','vendor/new-runtime-flag'],metadataSource:'verified-desktop-snapshot',goalAttribution:{status:'Observed',reason:'explicit-no-current-goal'},policy:{}};
  try {
    fixture.i18n.setLocalePreferences({language:'en'});
    const english=renderToStaticMarkup(React.createElement(fixture.thread.default,{task,privacy:false}));
    assert.ok(english.includes('<small>CollaborationMode</small><strong>Default mode</strong>'));
    assert.ok(english.includes('<small>Runtime</small><strong>Active</strong>'));
    assert.match(english,/No current Goal reported/);
    fixture.i18n.setLocalePreferences({language:'zh-CN'});
    const chinese=renderToStaticMarkup(React.createElement(fixture.thread.default,{task,privacy:false}));
    assert.ok(chinese.includes('<small>协作模式</small><strong>默认模式</strong>'));
    assert.ok(chinese.includes('<small>运行环境</small><strong>活跃</strong>'));
    assert.match(chinese,/已报告当前无 Goal/);
    assert.match(chinese,/default, vendor\/new-runtime-flag/);
    assert.match(chinese,/verified-desktop-snapshot/);
    const unknown=renderToStaticMarkup(React.createElement(fixture.thread.default,{task:{...task,collaborationMode:'vendor/new-mode',runtimeType:'new-runtime',goalAttribution:{status:'Unavailable',reason:'unrecognized-goal-relation'}},privacy:false}));
    assert.match(unknown,/vendor\/new-mode/);
    assert.match(unknown,/new-runtime/);
    assert.match(unknown,/unrecognized-goal-relation/);
  } finally {fixture.close();}
});

test('inventory and count placeholders localize by field without translating real model or tier identifiers', async () => {
 const fixture=await loadComponent();
 try {
  const props={privacy:false,groupBy:'model',groups:[{key:'Counter inventory (unknown attribution)',ledger:'baseline-counter-inventory'},{key:'default',ledger:'response',tierRequestCounts:{default:9,Unknown:246},collaborationModeCounts:{default:2}},{key:'Counter inventory (unknown attribution)',ledger:'response'}]};
  fixture.i18n.setLocalePreferences({language:'en'});
  const english=renderToStaticMarkup(React.createElement(fixture.module.StatisticsComparison,props));
  assert.ok(english.includes('Counter inventory (unknown attribution)'));
  assert.match(english,/Unknown: 246/);
  fixture.i18n.setLocalePreferences({language:'zh-CN'});
  const chinese=renderToStaticMarkup(React.createElement(fixture.module.StatisticsComparison,props));
  assert.match(chinese,/计数存量（归因未知）/);
  assert.match(chinese,/未知: 246/);
  assert.match(chinese,/default: 9/);
  assert.match(chinese,/默认模式: 2/);
  assert.ok(chinese.includes('<td>default<small>response'));
  assert.ok(chinese.includes('<td>Counter inventory (unknown attribution)<small>response'));
 }finally{fixture.close();}
});

test('diagnostic inventory and Goal counters render distinct evidence in both languages; repository privacy hides keys',async()=>{
 const f=await loadComponent();try{const diagnostic={rows:[{label:'Model catalog',source:'Official model/list',observedAt:null,ageMs:null,freshness:'Unavailable',coverage:'Unavailable',reason:'Catalog listing does not establish model entitlement'},{label:'Last quota poll',source:'Official account/rateLimits/read',observedAt:1800000000000,ageMs:60000,freshness:'Stale',coverage:'Observed',reason:'Reported windows only; missing windows remain unavailable'}],coverage:[{ledger:'baseline-counter-inventory',records:1,missingTotalTokens:1,missingModel:1}],limits:['Global and fork consumption are unverified']};for(const language of ['en','zh-CN']){f.i18n.setLocalePreferences({language});const html=renderToStaticMarkup(React.createElement(f.runtime.DiagnosticsInventory,{data:diagnostic}));assert.match(html,language==='en'?/No recorded observation time/:/没有已记录的观测时间/);assert.match(html,language==='en'?/Stale/:/观测已过期/);assert.match(html,language==='en'?/Baseline counter inventory/:/基线计数器清单/);const goalProps={presence:'present',status:'budgetLimited',tokenBudget:null,tokenBudgetState:'not-provided',tokensUsed:321,timeUsedSeconds:42,observedAt:1800000000000,source:'verified-desktop-ipc'};const budget=renderToStaticMarkup(React.createElement(f.thread.GoalDetails,{goal:goalProps}));const quota=renderToStaticMarkup(React.createElement(f.thread.GoalDetails,{goal:{...goalProps,status:'usageLimited'}}));assert.match(budget,language==='en'?/Goal budget limited/:/Goal 预算已用尽/);assert.match(quota,language==='en'?/Goal usage limited/:/Goal 受额度限制/);assert.match(budget,/321/);assert.match(budget,language==='en'?/Token budget not provided/:/未提供 Token 预算/);const privateRepo=renderToStaticMarkup(React.createElement(f.module.StatisticsComparison,{privacy:true,groupBy:'repository',groups:[{key:'PRIVATE_REPO_PATH',ledger:'response'}]}));assert.doesNotMatch(privateRepo,/PRIVATE_REPO_PATH/);const shownRepo=renderToStaticMarkup(React.createElement(f.module.StatisticsComparison,{privacy:false,groupBy:'repository',groups:[{key:'PRIVATE_REPO_PATH',ledger:'response'}]}));assert.match(shownRepo,/PRIVATE_REPO_PATH/);}}finally{f.close();}
});

test('diagnostics retry clears a transient error and preserves last evidence on a later failure',async()=>{const f=await loadComponent();try{let state={data:null,error:''},fail=true;const evidence={rows:[],coverage:null,limits:[]};const request=async()=>{if(fail)throw Error('temporary unavailable');return evidence};const commit=update=>state={...state,...update};await f.runtime.loadDiagnosticsInventory(request,commit);assert.match(state.error,/temporary unavailable/);assert.equal(state.data,null);fail=false;await f.runtime.loadDiagnosticsInventory(request,commit);assert.equal(state.error,'');assert.deepEqual(state.data,evidence);fail=true;await f.runtime.loadDiagnosticsInventory(request,commit);assert.deepEqual(state.data,evidence);assert.notEqual(state.error,'');}finally{f.close()}});
test('official account activity renders an independent scope and nullable thread usage in both languages',async()=>{const f=await loadComponent();try{const data={source:'official-app-server:account/usage/read',status:'Partial',fetchedAt:1800000000000,summary:{lifetimeTokens:1234,peakDailyTokens:null,longestRunningTurnSec:42,currentStreakDays:2,longestStreakDays:3},dailyBuckets:[{startDate:'2027-01-15',tokens:123}],threadUsage:{status:'Unavailable'}};for(const language of ['en','zh-CN']){f.i18n.setLocalePreferences({language});const html=renderToStaticMarkup(React.createElement(f.account.AccountActivityDetails,{data}));assert.match(html,/1,234/);assert.match(html,language==='en'?/Peak daily activity tokens/:/单日活动 Token 峰值/);assert.match(html,language==='en'?/Missing thread usage is unavailable, not zero/:/线程用量缺失表示不可用，不代表零/);assert.match(html,language==='en'?/Unavailable/:/不可用/);assert.match(html,/2027-01-15/);assert.doesNotMatch(html,/cumulative-delta: 1234/);}}finally{f.close()}});
