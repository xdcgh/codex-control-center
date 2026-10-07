import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ControlCenterCore } from '../src/core/control-center.mjs';
import { SqliteStore } from '../src/persistence/sqlite.mjs';
import { resolveOwnerAnchor } from '../src/core/ownership.mjs';
import { acquireLock } from '../src/store.mjs';
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

test('owner anchor and single-writer lock remain stable when LOCALAPPDATA changes', () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ccc-profile-acceptance-'));
  const previous = { user: process.env.USERPROFILE, app: process.env.LOCALAPPDATA, temp: process.env.TEMP };
  let release;
  try {
    process.env.USERPROFILE = profile;
    process.env.LOCALAPPDATA = path.join(profile, 'appdata-one');
    process.env.TEMP = path.join(profile, 'temp-one');
    const first = resolveOwnerAnchor({ create: true });
    assert.equal(path.resolve(first), path.resolve(profile, '.codex-control-center', 'owner'));
    release = acquireLock(first);

    process.env.LOCALAPPDATA = path.join(profile, 'appdata-two');
    process.env.TEMP = path.join(profile, 'temp-two');
    const second = resolveOwnerAnchor({ create: false });
    assert.equal(path.resolve(second), path.resolve(first));
    assert.throws(() => acquireLock(second), /watchdog-already-running/);
    assert.equal(fs.existsSync(path.join(profile, '.codex', 'owner')), false);

    const linkedProfile = path.join(profile, 'linked-profile');
    const outsideAnchor = path.join(profile, 'outside-anchor');
    fs.mkdirSync(linkedProfile);
    fs.mkdirSync(outsideAnchor);
    fs.symlinkSync(outsideAnchor, path.join(linkedProfile, '.codex-control-center'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => resolveOwnerAnchor({ profile: linkedProfile, create: true }), /owner-anchor-reparse-rejected/);
  } finally {
    release?.();
    if (previous.user == null) delete process.env.USERPROFILE; else process.env.USERPROFILE = previous.user;
    if (previous.app == null) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = previous.app;
    if (previous.temp == null) delete process.env.TEMP; else process.env.TEMP = previous.temp;
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

test('a lost config binding or stale owner/state marker never selects a new profile config', { skip: process.platform !== 'win32' || !process.env.CODEX_CONTROL_CENTER_NATIVE_TEST_HELPER }, async t => {
  const helper = process.env.CODEX_CONTROL_CENTER_NATIVE_TEST_HELPER;
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ccc-binding-acceptance-'));
  const profile = path.join(base, 'synthetic-user-profile', '.codex-control-center');
  fs.mkdirSync(profile, { recursive: true });
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const probe = () => {
    const result = spawnSync(helper, ['--probe-config-binding', profile], { windowsHide: true, encoding: 'utf8', timeout: 5000 });
    let value;
    try { value = JSON.parse(result.stdout); } catch { throw new Error('binding-probe-response-invalid'); }
    return { status: result.status, value };
  };

  assert.deepEqual(probe(), { status: 0, value: { selected: null } }); // Explicitly fresh profile has no saved state.
  const external = path.join(base, 'selected-config.json');
  fs.writeFileSync(external, JSON.stringify({ stateDirectory: path.join(base, 'external-state') }));
  fs.writeFileSync(path.join(profile, 'config-binding.json'), JSON.stringify({ config: external }));
  assert.deepEqual(probe(), { status: 0, value: { selected: external } });

  fs.unlinkSync(path.join(profile, 'config-binding.json'));
  fs.writeFileSync(path.join(profile, 'binding-established'), '1\n');
  const lostBinding = probe();
  assert.notEqual(lostBinding.status, 0);
  assert.match(lostBinding.value.error, /binding is missing/);
  assert.equal(fs.existsSync(path.join(profile, 'config.json')), false);
  assert.equal(fs.existsSync(path.join(profile, 'state')), false);

  fs.unlinkSync(path.join(profile, 'binding-established'));
  fs.mkdirSync(path.join(profile, 'owner'), { recursive: true });
  fs.writeFileSync(path.join(profile, 'owner', 'daemon.lock'), JSON.stringify({ pid: 99999999 }));
  assert.notEqual(probe().status, 0);
  assert.equal(fs.existsSync(path.join(profile, 'config.json')), false);
  fs.rmSync(path.join(profile, 'owner'), { recursive: true, force: true });
  fs.mkdirSync(path.join(profile, 'state'), { recursive: true });
  fs.writeFileSync(path.join(profile, 'state', 'control-center.sqlite'), 'SYNTHETIC-STATE-MARKER');
  assert.notEqual(probe().status, 0);
  assert.equal(fs.existsSync(path.join(profile, 'config.json')), false);
});

test('two simultaneous Resume now requests share the scheduled-resume concurrency slots', async () => {
  const ids = [idAt(30), idAt(31)];
  const r = makeRig({ ids, execute: true, settings: { maxConcurrentResumes: 1 } });
  try {
    await r.enrollQuotaStops();
    r.setQuota(limits({ used: 0, weekly: 0 }));
    const outcomes = await Promise.allSettled(ids.map(id => r.core.resumeNow(id)));
    assert.equal(outcomes.filter(x => x.status === 'fulfilled' && x.value.resumed).length, 1);
    assert.equal(outcomes.filter(x => x.status === 'rejected' && /resume-concurrency-limit/.test(x.reason.message)).length, 1);
    assert.equal(r.writes.length, 1);
  } finally { await r.close(); }
});

test('Resume now is a one-shot override for NeverAuto but preserves policy and still enforces quota, user, and compatibility gates', async t => {
  await t.test('successful manual turn does not clear NeverAuto', async () => {
    const r = makeRig({ execute: true });
    try {
      await r.enrollQuotaStops();
      r.core.setSettings({ autoResume: false });
      r.core.setThreadPolicy(THREAD, { autoResume: false, neverAutoResume: true });
      r.setQuota(limits({ used: 0, weekly: 0 }));
      const result = await r.core.resumeNow(THREAD);
      assert.equal(result.resumed, true);
      assert.equal(r.writes.length, 1);
      assert.equal(r.core.snapshot().tasks[0].policy.neverAutoResume, true);
      assert.equal(r.core.snapshot().tasks[0].policy.autoResume, false);
    } finally { await r.close(); }
  });
  await t.test('weekly quota still blocks the one-shot action', async () => {
    const r = makeRig({ execute: true });
    try {
      await r.enrollQuotaStops();
      r.core.setThreadPolicy(THREAD, { neverAutoResume: true });
      r.setQuota(limits({ used: 0, weekly: 100 }));
      await assert.rejects(r.core.resumeNow(THREAD), /quota-exhausted/);
      assert.equal(r.writes.length, 0);
      assert.equal(r.core.policy(THREAD).neverAutoResume, true);
    } finally { await r.close(); }
  });
  await t.test('a new approval request still blocks the one-shot action', async () => {
    const r = makeRig({ execute: true });
    try {
      await r.enrollQuotaStops();
      r.core.setThreadPolicy(THREAD, { neverAutoResume: true });
      r.states.set(THREAD, task({ status: 'failed', requests: [{ method: 'approval' }] }));
      r.setQuota(limits({ used: 0, weekly: 0 }));
      const result = await r.core.resumeNow(THREAD);
      assert.equal(result.resumed, false);
      assert.equal(r.writes.length, 0);
      assert.equal(r.core.policy(THREAD).neverAutoResume, true);
    } finally { await r.close(); }
  });
  await t.test('unknown compatibility blocks the one-shot action', async () => {
    const r = makeRig({ execute: true });
    try {
      await r.enrollQuotaStops();
      r.core.setThreadPolicy(THREAD, { neverAutoResume: true });
      r.adapter.compatibility.verified = false;
      r.setQuota(limits({ used: 0, weekly: 0 }));
      const result = await r.core.resumeNow(THREAD);
      assert.equal(result.resumed, false);
      assert.equal(r.writes.length, 0);
      assert.equal(r.core.policy(THREAD).neverAutoResume, true);
    } finally { await r.close(); }
  });
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
