import test from 'node:test';
import assert from 'node:assert/strict';
import { WatchdogEngine } from '../src/engine.mjs';
import { quotaStatus } from '../src/policy.mjs';
import { task, limits, NOW, THREAD, NEXT } from './fixtures.mjs';

function rig({ goalStatus, execute = true } = {}) {
  let clock = NOW, enabled = true, current = task({ status: 'inProgress', goalStatus: goalStatus ? 'active' : undefined });
  let quota = limits(); let saved; const writes = [], goals = [];
  const store = { load: () => saved ? structuredClone(saved) : { schemaVersion: 1, records: {}, ledger: {} }, save: (value) => { saved = structuredClone(value); } };
  const desktop = { snapshot: async () => ({ state: structuredClone(current), owner: 'owner' }), request: async (method, params, owner) => { writes.push({ method, params, owner }); return { handledByClientId: 'owner', result: { result: { turn: { id: NEXT } } } }; } };
  let actualGoal = goalStatus ? task({ goalStatus }).threadGoal : null;
  const account = { request: async (method, params) => {
    if (method === 'account/rateLimits/read') return quota;
    if (method === 'thread/goal/get') return { goal: structuredClone(actualGoal) };
    if (method === 'thread/goal/set') { goals.push(params); actualGoal.status = 'active'; current.threadGoal.status = 'active'; return { goal: structuredClone(actualGoal) }; }
    throw new Error('unexpected method');
  } };
  const build = () => new WatchdogEngine({ store, desktop, account, now: () => clock, enabled: () => enabled, execute });
  let engine = build(); engine.observe(THREAD, current, quotaStatus(quota, clock));
  current = task({ goalStatus }); engine.observe(THREAD, current, quotaStatus(quota, clock)); engine.save();
  return { get engine() { return engine; }, writes, goals, desktop, account, store,
    due() { clock = NOW + 180000; quota = limits({ used: 0, reset: clock + 18000000 }); },
    time(value) { clock = value; }, quota(value) { quota = value; }, snapshot(value) { current = value; }, disable() { enabled = false; },
    restart() { engine = build(); }, state: () => saved };
}
test('waits exactly until old reset plus 120 seconds, then continues the same conversation once', async () => {
  const r = rig(); r.time(NOW + 179999); assert.equal(await r.engine.recover(THREAD), false);
  r.due(); assert.equal(await r.engine.recover(THREAD), true);
  assert.equal(r.writes.length, 1); assert.equal(r.writes[0].params.conversationId, THREAD);
  assert.equal(r.writes[0].params.turnStart.context.inheritThreadSettings, true);
  assert.equal(await r.engine.recover(THREAD), false);
});
test('restart preserves the original wait deadline rather than chasing each new reset', async () => {
  const r = rig(); r.restart(); r.due(); await r.engine.recover(THREAD); assert.equal(r.writes.length, 1);
});
test('restores a quota-limited Goal without replacing objective, budget or execution settings', async () => {
  const r = rig({ goalStatus: 'usageLimited' }); r.due(); assert.equal(await r.engine.recover(THREAD), true);
  assert.deepEqual(r.goals, [{ threadId: THREAD, status: 'active' }]); assert.equal(r.writes.length, 1);
  assert.deepEqual(Object.keys(r.writes[0].params.turnStart.request).sort(), ['clientUserMessageId', 'input', 'threadId']);
});
test('unknown/exhausted quota, observe mode and a stopped watchdog send nothing', async () => {
  for (const kind of ['unknown', 'weekly', 'observe', 'disabled']) {
    const r = rig({ execute: kind !== 'observe' }); r.due();
    if (kind === 'unknown') r.quota({}); if (kind === 'weekly') r.quota(limits({ used: 0, weekly: 100 })); if (kind === 'disabled') r.disable();
    await r.engine.recover(THREAD); assert.equal(r.writes.length, 0);
  }
});
test('approval, manual pause, changed model or a new user turn suppress stale continuation', async () => {
  for (const kind of ['approval', 'paused', 'model', 'new-turn']) {
    const r = rig({ goalStatus: 'usageLimited' }); r.due(); const state = task({ goalStatus: 'usageLimited' });
    if (kind === 'approval') state.requests = [{ method: 'approval' }];
    if (kind === 'paused') state.threadGoal.status = 'paused';
    if (kind === 'model') state.latestModel = 'another-model';
    if (kind === 'new-turn') state.turnHistory.history.entitiesByKey.tail.turnId = NEXT;
    r.snapshot(state); await r.engine.recover(THREAD); assert.equal(r.writes.length, 0); assert.equal(r.goals.length, 0);
  }
});
test('a dropped acknowledgement becomes uncertain and survives restart without replay', async () => {
  const r = rig(); r.due(); r.desktop.request = async () => { r.writes.push('accepted-but-disconnected'); throw new Error('delivery-uncertain'); };
  await r.engine.recover(THREAD); assert.equal(r.writes.length, 1);
  r.restart(); await r.engine.recover(THREAD); assert.equal(r.writes.length, 1);
  assert.equal(r.engine.state.records[THREAD].phase, 'needsAttention');
});
test('already failed tasks never observed running are not silently enrolled', () => {
  const r = rig(); const other = '00000000-0000-4000-8000-000000000099'; const state = task({ overrides: { id: other } });
  r.engine.observe(other, state, quotaStatus(limits(), NOW)); assert.equal(r.engine.state.records[other], undefined);
});
test('a streamed state change during quota recheck prevents sending and permits a fresh retry', async () => {
  const r = rig(); r.due(); let generation = 0, calls = 0;
  const original = r.account.request;
  r.desktop.snapshot = async () => ({ state: task(), owner: 'owner', generation: 0 });
  r.desktop.getGeneration = () => generation;
  r.account.request = async (...args) => { calls++; if (calls === 2) generation++; return original(...args); };
  await r.engine.recover(THREAD); assert.equal(r.writes.length, 0); assert.equal(r.engine.state.records[THREAD].phase, 'waitingQuota');
});
test('a reset occurring between polls retains the observed old-window deadline', () => {
  let clock = NOW; const data = { schemaVersion: 1, records: {}, ledger: {} };
  const store = { load: () => data, save: () => {} };
  const engine = new WatchdogEngine({ store, now: () => clock, enabled: () => true });
  engine.observe(THREAD, task({ status: 'inProgress' }), quotaStatus(limits({ used: 99 }), clock));
  clock = NOW + 90000;
  engine.observe(THREAD, task(), quotaStatus(limits({ used: 0, reset: clock + 18000000 }), clock));
  assert.equal(engine.state.records[THREAD].notBeforeMs, NOW + 180000);
});
test('fast new quota failures between polls are enrolled; failures before enable are ignored', () => {
  const r = rig(); r.time(NOW + 2000);
  const other = '00000000-0000-4000-8000-000000000099'; const state = task({ overrides: { id: other } });
  state.turnHistory.history.entitiesByKey.tail.turnStartedAtMs = NOW + 1000;
  r.engine.observe(other, state, quotaStatus(limits(), NOW + 2000));
  assert.equal(r.engine.state.records[other].phase, 'waitingQuota');
  const old = '00000000-0000-4000-8000-000000000098'; state.id = old;
  r.engine.enrollmentSince = () => NOW + 1500;
  r.engine.observe(old, state, quotaStatus(limits(), NOW + 2000));
  assert.equal(r.engine.state.records[old], undefined);
});
test('a settings change during a quota stop remains suppressed on subsequent polls', async () => {
  const r = rig({ goalStatus: 'usageLimited' }); r.due(); const changed = task({ goalStatus: 'usageLimited' });
  changed.latestModel = 'another-model'; changed.threadGoal.tokenBudget = 8000; changed.threadGoal.updatedAt = (NOW + 180000) / 1000;
  r.snapshot(changed); await r.engine.recover(THREAD);
  r.engine.observe(THREAD, changed, quotaStatus(limits({ used: 0 }), NOW + 180000));
  await r.engine.recover(THREAD); assert.equal(r.writes.length, 0); assert.equal(r.engine.state.records[THREAD].phase, 'inactive');
});
