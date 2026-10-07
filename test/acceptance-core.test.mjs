import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ControlCenterCore } from '../src/core/control-center.mjs';
import { SqliteStore } from '../src/persistence/sqlite.mjs';
import { limits, NOW, NEXT, THREAD, task } from './fixtures.mjs';

const idAt = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const turnAt = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const withTurn = (state, turnId) => {
  state.turnHistory.history.entitiesByKey.tail.turnId = turnId;
  return state;
};
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

function makeRig({ ids = [THREAD], execute = true, settings = {}, requestHook, snapshotHook, verifyHook, quotaHook, goal = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ccc-core-acceptance-'));
  const file = path.join(directory, 'control.sqlite');
  let now = NOW;
  let quota = limits({ used: 100, weekly: 0 });
  let reads = 0;
  let snapshots = 0;
  let verifies = 0;
  let core;
  const states = new Map(ids.map(id => [id, task({ status: 'inProgress', goalStatus: goal ? 'active' : undefined, overrides: { id } })]));
  const generations = new Map(ids.map(id => [id, 0]));
  const writes = [];
  const reopens = [];
  let store = new SqliteStore(file, { now: () => now });
  const owner = 'fixture-desktop-owner';
  const desktop = {
    async snapshot(id) {
      snapshots++;
      if (snapshotHook) {
        const override = await snapshotHook({ id, count: snapshots, state: states.get(id), now });
        if (override instanceof Error) throw override;
      }
      return { state: structuredClone(states.get(id)), owner, generation: generations.get(id) };
    },
    getGeneration(id) { return generations.get(id); },
    async request(method, params, requestedOwner) {
      const entry = { method, threadId: params.conversationId, requestedOwner, params };
      writes.push(entry);
      if (requestHook) return requestHook({ entry, count: writes.length, now, states, generations });
      return { handledByClientId: owner, result: { result: { turn: { id: NEXT } } } };
    },
    unfollow() {},
  };
  const adapter = {
    desktop,
    account: {
      async request(method, params) {
        if (method === 'account/rateLimits/read') {
          reads++;
          if (quotaHook) {
            const override = await quotaHook({ count: reads, now, states, core, fromPoller: false, snapshots });
            if (override instanceof Error) throw override;
            if (override) return override;
          }
          return quota;
        }
        if (method === 'thread/goal/get') return { goal: structuredClone(states.get(params.threadId)?.threadGoal ?? null) };
        if (method === 'thread/goal/set') {
          const goal = states.get(params.threadId)?.threadGoal;
          if (!goal) throw new Error('fixture-goal-missing');
          goal.status = params.status;
          return { goal: structuredClone(goal) };
        }
        throw new Error(`fixture-unexpected-account-method:${method}`);
      },
    },
    source: 'acceptance-simulated-adapter',
    compatibility: { verified: true, cliVersion: 'fixture' },
    async connect() {},
    async readQuota() {
      if (quotaHook) {
        const override = await quotaHook({ count: reads + 1, now, states, core, fromPoller: true, snapshots });
        if (override instanceof Error) throw override;
        if (override) return override;
      }
      reads++;
      return quota;
    },
    listThreads: () => [...ids],
    isEligible: () => true,
    async snapshot(id) { return desktop.snapshot(id); },
    unfollow() {},
    verifyWriteSafety() { verifies++; verifyHook?.({ count: verifies, now, generations, states }); },
    probeCompatibility() {},
    reopen(id) { reopens.push(id); },
    async close() {},
  };
  const createCore = () => new ControlCenterCore({
    adapter, store, now: () => now, execute,
    settings: { autoResume: true, ...settings },
  });
  core = createCore();
  return {
    adapter, states, generations, writes, reopens, file,
    get store() { return store; },
    get core() { return core; }, get reads() { return reads; }, get snapshots() { return snapshots; }, get verifies() { return verifies; },
    setQuota(value) { quota = value; },
    setTime(value) { now = value; },
    advance(ms) { now += ms; return now; },
    async tick() { return core.tick(); },
    async enrollQuotaStops() {
      await core.tick();
      for (const id of ids) states.set(id, task({ status: 'failed', goalStatus: goal ? 'usageLimited' : undefined, overrides: { id } }));
      now += 10000;
      await core.tick();
    },
    restart: async () => { await core.close(); store.close(); store = new SqliteStore(file, { now: () => now }); core = createCore(); },
    async close() {
      await core.close();
      store.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('a recovered 5h window cannot resume while the weekly window remains exhausted', async () => {
  const r = makeRig();
  try {
    await r.enrollQuotaStops();
    r.advance(10000);
    r.setQuota(limits({ used: 0, weekly: 100 }));
    await r.tick();
    assert.equal(r.writes.length, 0);
    assert.equal(r.core.snapshot().quota.ready, false);
    assert.equal(r.core.snapshot().quota.weeklyRemainingPercent, 0);

    r.advance(10000);
    r.setQuota(limits({ used: 0, weekly: 0 }));
    await r.tick();
    assert.equal(r.writes.length, 1);
  } finally { await r.close(); }
});

test('quota display retains each window reset timestamp and only safe credits fields', async () => {
  const r = makeRig({ execute: false });
  try {
    const fiveHourReset = NOW + 30 * 60000;
    const weeklyReset = NOW + 3 * 86400000;
    const raw = limits({ used: 0, weekly: 100, reset: fiveHourReset, weeklyReset });
    raw.rateLimitsByLimitId.codex.planType = 'fixture-plan';
    raw.rateLimitsByLimitId.codex.credits = { hasCredits: true, unlimited: false, balance: '12', privateField: 'must-not-escape' };
    r.setQuota(raw);
    await r.core.pollQuota();
    const quota = r.core.snapshot().quota;
    assert.equal(quota.ready, false);
    assert.equal(quota.resetsAtMs, weeklyReset);
    assert.deepEqual(quota.windows, [
      { durationMinutes: 300, usedPercent: 0, remainingPercent: 100, resetsAt: fiveHourReset },
      { durationMinutes: 10080, usedPercent: 100, remainingPercent: 0, resetsAt: weeklyReset },
    ]);
    assert.deepEqual(quota.credits, { hasCredits: true, unlimited: false, balance: '12' });
    assert.equal(quota.planType, 'fixture-plan');
  } finally { await r.close(); }
});

test('settings changed through the public API survive reopening SQLite and override startup defaults', async () => {
  const r = makeRig({ execute: false, settings: { recoveryPollSeconds: 10, historySampleSeconds: 60 } });
  try {
    r.core.setSettings({ recoveryPollSeconds: 30, historySampleSeconds: 120, reservePercent: 15 });
    await r.restart();
    const settings = r.core.snapshot().settings;
    assert.equal(settings.recoveryPollSeconds, 30);
    assert.equal(settings.historySampleSeconds, 120);
    assert.equal(settings.reservePercent, 15);
  } finally { await r.close(); }
});

test('a sent continuation ledger prevents duplicate delivery after duplicate failure events and restart', async () => {
  const r = makeRig();
  try {
    await r.enrollQuotaStops();
    r.advance(10000);
    r.setQuota(limits({ used: 0, weekly: 0 }));
    await r.tick();
    assert.equal(r.writes.length, 1);

    await r.restart();
    r.advance(10000);
    await r.tick();
    await r.tick();
    assert.equal(r.writes.length, 1);
    assert.equal(r.core.snapshot().tasks[0].phase, 'watching');
    assert.equal(r.core.snapshot().tasks[0].reason, 'continuation-accepted');
    const ledger = r.store.load().ledger[`${THREAD}:${'00000000-0000-4000-8000-000000000002'}`];
    assert.ok(['sent', 'confirmed'].includes(ledger.phase));
  } finally { await r.close(); }
});

test('manual pause, needs-user state, and a changed current turn each suppress dispatch', async t => {
  for (const scenario of ['manual-pause', 'needs-user', 'changed-turn']) {
    await t.test(scenario, async () => {
      const r = makeRig();
      try {
        await r.enrollQuotaStops();
        if (scenario === 'manual-pause') r.core.setThreadPolicy(THREAD, { manualPaused: true });
        if (scenario === 'needs-user') r.states.set(THREAD, task({ status: 'failed', requests: [{ method: 'approval' }] }));
        if (scenario === 'changed-turn') {
          const next = task({ status: 'completed' });
          next.turnHistory.history.entitiesByKey.tail.turnId = turnAt(9);
          r.states.set(THREAD, next);
        }
        r.advance(10000);
        r.setQuota(limits({ used: 0, weekly: 0 }));
        await r.tick();
        assert.equal(r.writes.length, 0);
        if (scenario === 'manual-pause') assert.equal(r.core.snapshot().tasks[0].policy.manualPaused, true);
        if (scenario === 'needs-user') assert.equal(r.core.snapshot().tasks[0].phase, 'needsUser');
        if (scenario === 'changed-turn') assert.equal(r.core.snapshot().tasks[0].phase, 'inactive');
      } finally { await r.close(); }
    });
  }
});

test('a pause arriving during the final quota check remains persisted and blocks dispatch', async () => {
  let paused = false;
  const r = makeRig({ quotaHook: ({ fromPoller, core: activeCore, snapshots }) => {
    // The final pre-dispatch account read follows both fresh Desktop snapshots.
    if (!fromPoller && !paused && snapshots >= 4) {
      paused = true;
      activeCore.setThreadPolicy(THREAD, { manualPaused: true });
    }
    return undefined;
  } });
  try {
    await r.enrollQuotaStops();
    r.advance(10000);
    r.setQuota(limits({ used: 0, weekly: 0 }));
    await r.tick();
    assert.equal(r.writes.length, 0);
    assert.equal(paused, true);
    assert.equal(r.core.snapshot().tasks[0].policy.manualPaused, true);
  } finally { await r.close(); }
});

test('priority, reserve, and maxConcurrentResumes select one eligible task at a time', async () => {
  const ids = [idAt(10), idAt(11), idAt(12)];
  const r = makeRig({ ids, settings: { maxConcurrentResumes: 1, reservePercent: 10 } });
  try {
    await r.enrollQuotaStops();
    r.core.setThreadPolicy(ids[0], { priority: 0 });
    r.core.setThreadPolicy(ids[1], { priority: 1 });
    r.core.setThreadPolicy(ids[2], { priority: 2 });
    r.advance(10000);
    r.setQuota(limits({ used: 0, weekly: 0 }));
    await r.tick();
    assert.deepEqual(r.writes.map(w => w.threadId), [ids[0]]);
    assert.equal(r.core.snapshot().tasks.filter(t => t.phase === 'watching' && t.reason === 'continuation-accepted').length, 1);

    r.states.set(ids[0], withTurn(task({ status: 'inProgress', overrides: { id: ids[0] } }), NEXT));
    r.advance(10000);
    r.setQuota(limits({ used: 90, weekly: 0, reset: NOW + 3600000 })); // 10% remaining is at the reserve boundary.
    await r.tick();
    assert.deepEqual(r.writes.map(w => w.threadId), [ids[0]]); // An observed running turn still occupies the slot.

    r.states.set(ids[0], withTurn(task({ status: 'completed', overrides: { id: ids[0] } }), NEXT));
    r.advance(10000);
    await r.tick();
    assert.deepEqual(r.writes.map(w => w.threadId), [ids[0], ids[1]]); // P1 bypasses reserve; P2 waits.

    r.states.set(ids[1], withTurn(task({ status: 'inProgress', overrides: { id: ids[1] } }), NEXT));
    r.advance(10000);
    await r.tick();
    assert.deepEqual(r.writes.map(w => w.threadId), [ids[0], ids[1]]);

    r.states.set(ids[1], withTurn(task({ status: 'completed', overrides: { id: ids[1] } }), NEXT));
    r.advance(10000);
    await r.tick();
    assert.deepEqual(r.writes.map(w => w.threadId), [ids[0], ids[1]]); // P2 remains below reserve.
    r.core.setThreadPolicy(ids[2], { priority: 1 });
    r.advance(10000);
    await r.tick();
    assert.deepEqual(r.writes.map(w => w.threadId), [ids[0], ids[1], ids[2]], JSON.stringify(r.core.snapshot().tasks));
  } finally { await r.close(); }
});

test('a definite pre-send generation race retries only after cooldown; ambiguous delivery is never replayed', async t => {
  await t.test('generation changed before write', async () => {
    let mutateOnVerify = 3;
    const r = makeRig({ settings: { maxRetries: 2, cooldownSeconds: 30 }, verifyHook: ({ count, generations }) => {
      if (count === mutateOnVerify) generations.set(THREAD, generations.get(THREAD) + 1);
    } });
    try {
      await r.enrollQuotaStops();
      r.advance(10000);
      r.setQuota(limits({ used: 0, weekly: 0 }));
      await r.tick();
      assert.equal(r.writes.length, 0);
      assert.equal(r.core.snapshot().tasks[0].policy.retryCount, 1);
      r.advance(20000);
      await r.tick();
      assert.equal(r.writes.length, 0);
      r.advance(20000);
      await r.tick();
      assert.equal(r.writes.length, 1);
    } finally { await r.close(); }
  });

  await t.test('uncertain acknowledgement survives restart without replay', async () => {
    const r = makeRig({ requestHook: async ({ entry }) => {
      throw new Error('fixture-lost-ack');
    } });
    try {
      await r.enrollQuotaStops();
      r.advance(10000);
      r.setQuota(limits({ used: 0, weekly: 0 }));
      await r.tick();
      assert.equal(r.writes.length, 1);
      assert.equal(r.core.snapshot().tasks[0].phase, 'needsAttention');
      await r.restart();
      r.advance(10000);
      await r.tick();
      assert.equal(r.writes.length, 1);
      assert.equal(r.store.load().ledger[`${THREAD}:${'00000000-0000-4000-8000-000000000002'}`].phase, 'uncertain');
    } finally { await r.close(); }
  });
});

test('10-second quota polls run independently of a slow Thread snapshot; history is sampled every 60 seconds', async () => {
  const started = deferred();
  const finishSnapshot = deferred();
  let holdFirstSnapshot = true;
  const r = makeRig({ execute: false });
  try {
    r.adapter.desktop.snapshot = async id => {
      if (holdFirstSnapshot) {
        holdFirstSnapshot = false;
        started.resolve();
        await finishSnapshot.promise;
      }
      return { state: structuredClone(r.states.get(id)), owner: 'fixture-desktop-owner', generation: r.generations.get(id) };
    };
    const firstTick = r.tick();
    await started.promise;
    assert.equal(r.reads, 1);
    r.advance(10000);
    await r.core.pollQuota();
    assert.equal(r.reads, 2);
    assert.equal(r.store.queryQuotaHistory().length, 2);
    finishSnapshot.resolve();
    await firstTick;

    for (let i = 0; i < 5; i++) {
      r.advance(10000);
      await r.tick();
    }
    assert.equal(r.reads, 7);
    const rows = r.store.queryQuotaHistory();
    assert.equal(rows.length, 4); // two quota windows at t=0 and two at t=60s.
    assert.deepEqual([...new Set(rows.map(row => row.timestamp))], [NOW, NOW + 60000]);
  } finally { finishSnapshot.resolve(); await r.close(); }
});

test('quota query errors use bounded exponential backoff and do not write history on failure', async () => {
  const r = makeRig({ execute: false });
  let readAttempts = 0;
  r.adapter.readQuota = async () => { readAttempts++; throw new Error('fixture-network-failure'); };
  try {
    await r.core.pollQuota();
    assert.equal(readAttempts, 1);
    assert.equal(r.core.snapshot().quota.known, false);
    assert.equal(r.core.snapshot().nextQuotaPollAt, NOW + 20000);
    assert.equal(r.store.queryQuotaHistory().length, 0);
    r.advance(10000);
    await r.core.pollQuota();
    assert.equal(readAttempts, 1);
    r.advance(10000);
    await r.core.pollQuota();
    assert.equal(readAttempts, 2);
    assert.equal(r.core.snapshot().nextQuotaPollAt, NOW + 60000);
  } finally { await r.close(); }
});

test('a Desktop that has unloaded the same Thread is reopened only after quota is ready, without dispatch', async () => {
  let missing = false;
  const r = makeRig({ snapshotHook: ({ state }) => missing ? new Error('no-client-found') : undefined });
  try {
    await r.enrollQuotaStops();
    missing = true;
    r.advance(10000);
    r.setQuota(limits({ used: 0, weekly: 0 }));
    await r.tick();
    assert.equal(r.writes.length, 0);
    assert.deepEqual(r.reopens, [THREAD]);
    assert.equal(r.core.snapshot().quota.ready, true);
    assert.equal(r.core.snapshot().tasks[0].unavailableReason, 'no-client-found');

    missing = false;
    r.advance(10000);
    await r.tick();
    assert.equal(r.core.snapshot().tasks[0].unavailableReason, undefined);
    assert.equal(r.writes.length, 1);
  } finally { await r.close(); }
});

test('an unloaded Goal that the user has paused is not reopened or resumed', async () => {
  let missing = false;
  const r = makeRig({ goal: true, snapshotHook: () => missing ? new Error('no-client-found') : undefined });
  try {
    await r.enrollQuotaStops();
    missing = true;
    r.states.set(THREAD, task({ status: 'failed', goalStatus: 'paused' }));
    r.advance(10000);
    r.setQuota(limits({ used: 0, weekly: 0 }));
    await r.tick();
    assert.deepEqual(r.reopens, []);
    assert.equal(r.writes.length, 0);
  } finally { await r.close(); }
});
