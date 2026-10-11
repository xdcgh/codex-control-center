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
  return {
    module: await import(pathToFileURL(path.join(dir, 'comparison.mjs'))),
    thread: await import(pathToFileURL(path.join(dir, 'thread.mjs'))),
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
