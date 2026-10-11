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
  const component = withExplicitExtension(await compile('ui/src/StatisticsComparison.tsx', 'StatisticsComparison.tsx'), 'i18n');
  fs.writeFileSync(path.join(dir, 'i18n-core.mjs'), core);
  fs.writeFileSync(path.join(dir, 'i18n.mjs'), i18n);
  fs.writeFileSync(path.join(dir, 'comparison.mjs'), component);
  return {
    module: await import(pathToFileURL(path.join(dir, 'comparison.mjs'))),
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
    assert.match(chinese, /Unknown: 10/);

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
    assert.match(english, /unknown: 3/);
    assert.match(english, /125 \/ 100 \/ 250/);
    assert.match(english, /25%/);

    fixture.i18n.setLocalePreferences({ language: 'zh-CN' });
    const chinese = renderToStaticMarkup(React.createElement(fixture.module.StatisticsComparison, props));
    assert.match(chinese, /模型、档位与上下文对比/);
    assert.match(chinese, /不可用/);
    assert.match(chinese, /test-model/);
    assert.match(chinese, /unknown: 3/);
  } finally {
    fixture.close();
  }
});
