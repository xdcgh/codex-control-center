import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { inspectBundle, SUPPORTED } from './bundle.mjs';
import { AccountClient } from './rpc.mjs';
import { DesktopClient } from './ipc.mjs';
import { listRootThreads, isRootThreadEligible } from './catalog.mjs';
import { assess, quotaStatus, goalIdentity } from './policy.mjs';
import { StateStore, atomicWrite, readJson, acquireLock, makeLogger } from './store.mjs';
import { WatchdogEngine } from './engine.mjs';
import { verifyCurrentDesktop, openExistingThread } from './desktop-host.mjs';

const argumentsList = process.argv.slice(2);
const command = argumentsList[0] ?? 'status';
const position = argumentsList.indexOf('--config');
const configPath = position >= 0 ? argumentsList[position + 1] : path.resolve(import.meta.dirname, '../runtime/config.json');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function loadConfig() {
  const config = readJson(configPath);
  if (config?.schemaVersion !== 1 || ![config.codexBin, config.codexHome, config.asarPath, config.stateDirectory].every((value) => typeof value === 'string' && path.isAbsolute(value))) throw new Error('invalid-watchdog-config');
  if (config.resetBufferSeconds !== 120 || !Number.isInteger(config.pollSeconds) || config.pollSeconds < 10 || config.pollSeconds > 60) throw new Error('invalid-watchdog-timing');
  return config;
}
function checkCompatibility(config) {
  const bundle = inspectBundle(config.asarPath);
  if (!bundle.compatible) throw new Error('desktop-version-needs-adaptation');
  const result = spawnSync(config.codexBin, ['--version'], { windowsHide: true, encoding: 'utf8', timeout: 5000 });
  if (result.status !== 0 || result.stdout.trim() !== `codex-cli ${SUPPORTED.cliVersion}`) throw new Error('cli-version-needs-adaptation');
  return bundle;
}
function enabled(config) { const control = readJson(path.join(config.stateDirectory, 'control.json'), { enabled: false }); return control.enabled === true && control.stop !== true; }
function output(value) { process.stdout.write(JSON.stringify(value, null, 2) + '\n'); }

async function doctor(config) {
  const bundle = checkCompatibility(config);
  const peer = verifyCurrentDesktop(config);
  const desktop = new DesktopClient({ timeoutMs: 4000 });
  const account = new AccountClient(config);
  const result = { compatible: true, ...peer, appVersion: bundle.appVersion, cliVersion: SUPPORTED.cliVersion, quota: null, tasks: [], inaccessibleThreads: 0 };
  try {
    await desktop.connect(); await account.start();
    result.quota = quotaStatus(await account.request('account/rateLimits/read'), Date.now());
    for (const threadId of listRootThreads(config.codexHome, Date.now())) {
      try {
        const { state } = await desktop.snapshot(threadId);
        const decision = assess(state, { catalogPersistent: true });
        if (['running', 'quotaFailure'].includes(decision.action)) result.tasks.push({ threadId, state: decision.action, goalStatus: state.threadGoal?.status ?? null });
        desktop.unfollow(threadId);
      } catch (error) {
        if (error.message !== 'no-client-found') throw error;
        result.inaccessibleThreads++;
      }
    }
    if (!result.quota.known) throw new Error(result.quota.reason);
    return result;
  } finally { desktop.close(); await account.close(); }
}

async function run(config, execute) {
  const release = acquireLock(config.stateDirectory);
  const logger = makeLogger(config.stateDirectory);
  const statusPath = path.join(config.stateDirectory, 'status.json');
  const store = new StateStore(config.stateDirectory);
  let desktop = new DesktopClient({ timeoutMs: 6000 });
  let account = new AccountClient(config);
  let halted = false;
  let lastError = null;
  let lastCompatibilityCheck = 0;
  let quota = null;
  let lastPeerCheck = 0;
  const openAttempts = new Map();
  const engine = new WatchdogEngine({ store, desktop, account, enabled: () => !halted && enabled(config), enrollmentSince: () => readJson(path.join(config.stateDirectory, 'control.json'), {}).updatedAt ?? Date.parse(engine.state.startedAt), verifyDesktop: () => verifyCurrentDesktop(config), execute, resetBufferMs: 120000, log: logger });
  const reopenPending = async (threadId) => {
    const record = engine.state.records[threadId];
    if (!execute || !record?.failureTurnId || record.notBeforeMs == null || record.notBeforeMs > Date.now() || !quota?.ready || !enabled(config) || Date.now() - (openAttempts.get(threadId) ?? 0) < 120000) return;
    if (record.kind === 'goal') {
      const goal = (await account.request('thread/goal/get', { threadId })).goal;
      if (goal?.status !== 'usageLimited' || goalIdentity(goal) !== record.goalIdentity) return;
    }
    verifyCurrentDesktop(config); openAttempts.set(threadId, Date.now());
    openExistingThread(threadId); logger('opening-pending-chat', { threadId });
  };
  const incompatible = () => { halted = true; logger('desktop-protocol-changed'); };
  desktop.on('incompatible', incompatible);
  const stop = () => { halted = true; };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  logger('watchdog-started', { pid: process.pid, mode: execute ? 'execute' : 'observe', appVersion: SUPPORTED.appVersion });
  atomicWrite(statusPath, { pid: process.pid, startedAt: Date.now(), mode: execute ? 'execute' : 'observe', phase: 'starting', configPath });
  try {
    while (!halted) {
      const control = readJson(path.join(config.stateDirectory, 'control.json'), { enabled: false });
      if (control.stop) break;
      if (Date.now() - lastCompatibilityCheck > 60000) { checkCompatibility(config); lastCompatibilityCheck = Date.now(); }
      let phase = control.enabled ? 'monitoring' : 'paused';
      try {
        if (control.enabled) {
          await desktop.connect(); await account.start();
          if (Date.now() - lastPeerCheck > 60000) { verifyCurrentDesktop(config); lastPeerCheck = Date.now(); }
          quota = quotaStatus(await account.request('account/rateLimits/read'), Date.now());
          const ids = new Set(listRootThreads(config.codexHome, Date.now()));
          for (const [id, record] of Object.entries(engine.state.records)) if (record.failureTurnId) ids.add(id);
          for (const threadId of ids) {
            if (halted || !enabled(config)) break;
            try {
              if (!isRootThreadEligible(config.codexHome, threadId)) {
                const record = engine.state.records[threadId];
                if (record) { engine.transition(record, 'inactive', 'archived-or-no-longer-root'); delete record.failureTurnId; engine.save(); }
                continue;
              }
              const { state } = await desktop.snapshot(threadId);
              if (engine.state.records[threadId]?.failureTurnId && (state.resumeState !== 'resumed' || state.threadRuntimeStatus?.type === 'notLoaded')) { await reopenPending(threadId); desktop.unfollow(threadId); continue; }
              engine.observe(threadId, state, quota);
              engine.save();
              await engine.recover(threadId);
              desktop.unfollow(threadId);
            } catch (error) {
              if (!['no-client-found', 'desktop-snapshot-timeout'].includes(error.message)) throw error;
              await reopenPending(threadId);
            }
          }
          if (quota.known && Number.isFinite(quota.resetsAtMs)) { engine.state.lastQuotaResetMs = quota.resetsAtMs; engine.save(); }
        }
        if (lastError) logger('connection-recovered', { previous: lastError });
        lastError = null;
      } catch (error) {
        if (['desktop-version-needs-adaptation','cli-version-needs-adaptation','desktop-owner-not-supported'].includes(error.message)) throw error;
        phase = 'waitingForDesktopOrNetwork';
        if (lastError !== error.message) logger('connection-unavailable', { reason: error.message });
        lastError = error.message;
        desktop.close(); await account.close();
        desktop = new DesktopClient({ timeoutMs: 6000 }); desktop.on('incompatible', incompatible);
        account = new AccountClient(config);
        engine.desktop = desktop; engine.account = account;
      }
      const tasks = Object.values(engine.state.records).map((record) => ({ threadId: record.threadId, phase: record.phase, reason: record.reason, goal: record.kind === 'goal', notBeforeMs: record.notBeforeMs ?? null }));
      atomicWrite(statusPath, { pid: process.pid, startedAt: Date.parse(engine.state.startedAt), checkedAt: Date.now(), mode: execute ? 'execute' : 'observe', phase, enabled: control.enabled, quota, tasks, lastError });
      // No model is involved in this timer, quota polling or catalog/IPC observation.
      for (let elapsed = 0; elapsed < config.pollSeconds * 1000 && !halted; elapsed += 1000) {
        if (readJson(path.join(config.stateDirectory, 'control.json'), {}).stop) { halted = true; break; }
        await sleep(1000);
      }
    }
  } catch (error) {
    logger('watchdog-stopped-with-error', { reason: error.message });
    atomicWrite(statusPath, { pid: process.pid, checkedAt: Date.now(), mode: execute ? 'execute' : 'observe', phase: 'needsAttention', error: error.message });
    throw error;
  } finally {
    desktop.close(); await account.close(); release();
    logger('watchdog-stopped');
    const previous = readJson(statusPath, {});
    atomicWrite(statusPath, { ...previous, running: false, stoppedAt: Date.now() });
  }
}

try {
  const config = loadConfig();
  if (command === 'doctor') output(await doctor(config));
  else if (command === 'status') {
    const status = readJson(path.join(config.stateDirectory, 'status.json'), { phase: 'notStarted' });
    let alive = false; if (status.pid) { try { process.kill(status.pid, 0); alive = true; } catch {} }
    output({ ...status, processAlive: alive && status.running !== false, control: readJson(path.join(config.stateDirectory, 'control.json'), { enabled: false }) });
  }
  else if (['pause', 'stop', 'enable'].includes(command)) {
    const control = { enabled: command === 'enable', stop: command === 'stop', updatedAt: Date.now() };
    atomicWrite(path.join(config.stateDirectory, 'control.json'), control); output(control);
  }
  else if (command === 'run') await run(config, argumentsList.includes('--execute'));
  else throw new Error('usage: doctor | status | run [--execute] | pause | enable | stop');
} catch (error) { output({ ok: false, error: error.message }); process.exitCode = 1; }
