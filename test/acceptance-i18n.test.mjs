import test from 'node:test';
import assert from 'node:assert/strict';
import {
  catalog, resolveLocale, translate, localizeValue, localizeOwnedValue, formatNumber, formatDate,
} from '../ui/src/i18n-core.ts';

test('system language and manual override resolve deterministically', () => {
  assert.equal(resolveLocale('auto', 'zh-CN'), 'zh-CN');
  assert.equal(resolveLocale('auto', 'zh-TW'), 'zh-CN');
  assert.equal(resolveLocale('auto', 'zh-HK'), 'zh-CN');
  assert.equal(resolveLocale('auto', 'en-GB'), 'en');
  assert.equal(resolveLocale('auto', 'ja-JP'), 'en');
  assert.equal(resolveLocale('auto', null, ['zh-Hans-CN']), 'zh-CN');
  assert.equal(resolveLocale('auto', null, ['fr-FR']), 'en');
  assert.equal(resolveLocale('zh-CN', 'en-GB'), 'zh-CN');
  assert.equal(resolveLocale('en', 'zh-CN'), 'en');
});

test('every catalog key has non-empty English and Chinese copy with matching placeholders', () => {
  const entries = Object.entries(catalog);
  assert.ok(entries.length > 250, `expected the full UI catalog, found ${entries.length} keys`);
  for (const [key, chinese] of entries) {
    assert.equal(translate(key, 'en'), key, `English fallback for ${key}`);
    assert.equal(translate(key, 'zh-CN'), chinese, `Chinese translation for ${key}`);
    assert.ok(key.trim().length > 0 && chinese.trim().length > 0, `empty catalog entry: ${key}`);
    assert.notEqual(chinese, key, `Chinese catalog entry still falls back to English: ${key}`);
    assert.deepEqual(
      [...(key.matchAll(/\{\w+\}/g))].map(match => match[0]).sort(),
      [...(chinese.matchAll(/\{\w+\}/g))].map(match => match[0]).sort(),
      `placeholder mismatch for ${key}`,
    );
  }
});

test('known product labels and data quality values localize without changing identifiers', () => {
  assert.equal(localizeValue('Unavailable', 'zh-CN'), '不可用');
  assert.equal(localizeValue('Working', 'zh-CN'), '运行中');
  assert.equal(localizeValue('Exact current Goal relation was not observed', 'zh-CN'), '未观测到精确的当前 Goal 关联');
  assert.equal(localizeValue('desktop-version-or-hash-unverified', 'zh-CN'), 'desktop-version-or-hash-unverified');
  assert.equal(localizeValue('gpt-6.1-sol', 'zh-CN'), 'gpt-6.1-sol');
  assert.equal(localizeValue('vendor/new-model-v3', 'en'), 'vendor/new-model-v3');
  assert.equal(localizeValue('thread-1234', 'zh-CN'), 'thread-1234');
});

test('formatting and parameterized messages retain missing-data quality', () => {
  assert.equal(formatNumber(null, 'zh-CN'), '不可用');
  assert.equal(formatDate('not a date', 'zh-CN'), '不可用');
  assert.equal(translate('Next check in {seconds}s', 'zh-CN', { seconds: 15 }), '15 秒后再次检查');
  assert.equal(translate('Next check in {seconds}s', 'zh-CN'), '{seconds} 秒后再次检查');
  assert.equal(translate('Next check in {seconds}s', 'en', { seconds: 15 }), 'Next check in 15s');
});

test('field-scoped product states explain verified enums and preserve unknown values', () => {
 assert.equal(localizeOwnedValue('taskReason','running','zh-CN'),'运行中');
 assert.equal(localizeOwnedValue('taskReason','running','en'),'Working');
 assert.equal(localizeOwnedValue('taskReason','goal-budgetLimited','zh-CN'),'Goal Token 预算已耗尽');
 assert.equal(localizeOwnedValue('collaboration','default','zh-CN'),'默认模式');
 assert.equal(localizeOwnedValue('runtime','active','zh-CN'),'活跃');
 assert.equal(localizeOwnedValue('goalRelation','canonical-turn-starts-within-current-active-goal','zh-CN'),'标准轮次开始于当前活动 Goal 内');
 for(const field of ['taskReason','collaboration','runtime','goalRelation','inventory'])assert.equal(localizeOwnedValue(field,'vendor/unrecognized-value','zh-CN'),'vendor/unrecognized-value');
 assert.equal(localizeValue('default','zh-CN'),'default');
 assert.equal(localizeValue('running','zh-CN'),'running');
});
