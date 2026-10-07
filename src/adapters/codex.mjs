import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { AccountClient } from '../rpc.mjs';
import { DesktopClient } from '../ipc.mjs';
import { inspectBundle, SUPPORTED } from '../bundle.mjs';
import { listRootThreads, isRootThreadEligible } from '../catalog.mjs';
import { verifyCurrentDesktop, openExistingThread } from '../desktop-host.mjs';
import { readJson } from '../store.mjs';
import { assess, quotaStatus, isUuid } from '../policy.mjs';
import { resolveOwnerAnchor } from '../core/ownership.mjs';

export class OfficialAppServerAdapter {
  constructor(config) { this.config = config; this.client = new AccountClient(config); this.source = 'official-app-server'; }
  async connect() {
    this.ready ??= this.client.start().catch(error=>{this.ready=null;throw error;});
    await this.ready;
  }
  request(method, params) {
    if (['account/rateLimits/read','thread/goal/get','thread/goal/set'].includes(method)) return this.client.request(method, params);
    if (!['model/list','thread/read'].includes(method)) throw new Error('official-method-not-allowed');
    return this.client.raw(method, params);
  }
  readQuota() { return this.request('account/rateLimits/read'); }
  getGoal(id) { return this.request('thread/goal/get', { threadId: id }); }
  readThread(id) { return this.request('thread/read', { threadId: id, includeTurns: true }); }
  async listModels() {
    const models = []; let cursor = null;
    for (let page = 0; page < 100; page++) {
      const result = await this.request('model/list', { limit: 100, ...(cursor ? { cursor } : {}) });
      if (!Array.isArray(result.data)) throw new Error('model-catalog-schema-changed');
      models.push(...result.data); if (!result.nextCursor) return models;
      if (result.nextCursor === cursor) throw new Error('model-catalog-cursor-stalled');
      cursor = result.nextCursor;
    }
    throw new Error('model-catalog-too-many-pages');
  }
  async close() { this.ready=null; await this.client.close(); }
}

export class DesktopIpcAdapter {
  constructor(config) { this.config = config; this.client = new DesktopClient({ timeoutMs: config.timeoutMs ?? 6000 }); }
  connect() { return this.client.connect(); }
  snapshot(id) { return this.client.snapshot(id); }
  getGeneration(id) { return this.client.getGeneration(id); }
  request(...args) { return this.client.request(...args); }
  unfollow(id) { this.client.unfollow(id); }
  close() { this.client.close(); }
}

export class CompatibilityProbe {
  constructor(config) { this.config = config; }
  inspect() {
    let bundle = null, cliVersion = null; const issues = [];
    try { bundle = inspectBundle(this.config.asarPath); if (!bundle.compatible) issues.push('desktop-version-or-hash-unverified'); }
    catch { issues.push('desktop-bundle-unavailable'); }
    try {
      const result = spawnSync(this.config.codexBin, ['--version'], { windowsHide: true, encoding: 'utf8', timeout: 5000 });
      if (result.status === 0) cliVersion = result.stdout.trim().replace(/^codex-cli /, '');
      if (cliVersion !== SUPPORTED.cliVersion) issues.push('cli-version-unverified');
    } catch { issues.push('cli-version-unavailable'); }
    return { verified: issues.length === 0, safeMode: issues.length !== 0, cliVersion, desktopVersion: bundle?.appVersion ?? null,
      protocolVersion: { ...SUPPORTED.versions }, protocolHash: bundle?.protocolHash ?? null, issues,
      status: issues.length ? 'Compatibility not verified' : 'verified', checkedAt: Date.now() };
  }
}

export function inspectLegacyOwners() {
  if(process.platform!=='win32')throw new Error('fresh-install-owner-proof-requires-windows');
  const powershell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
  const script=`$ErrorActionPreference='Stop'; $task=Get-ScheduledTask -TaskName 'CodexQuotaWatchdog' -ErrorAction SilentlyContinue; $processes=@(Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='powershell.exe'" | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match 'codex-quota-watchdog.*(cli[.]mjs|Start-Watchdog[.]ps1)' }); [pscustomobject]@{legacyTaskPresent=($null -ne $task);legacyProcesses=$processes.Count}|ConvertTo-Json -Compress`;
  const result=spawnSync(powershell,['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,encoding:'utf8',timeout:8000});
  if(result.status!==0)throw new Error('legacy-owner-proof-unavailable');
  let proof;try{proof=JSON.parse(result.stdout);}catch{throw new Error('legacy-owner-proof-invalid');}
  if(typeof proof.legacyTaskPresent!=='boolean'||!Number.isInteger(proof.legacyProcesses))throw new Error('legacy-owner-proof-invalid');
  return proof;
}

export function assertOwnerHandover(config,{legacyProbe=inspectLegacyOwners,ownerAnchor=resolveOwnerAnchor}={}) {
  if(!config.legacyStateDirectory) {
    if(config.installationMode!=='fresh')throw new Error('explicit-owner-handover-required');
    const proof=legacyProbe();
    if(proof.legacyTaskPresent||proof.legacyProcesses>0)throw new Error('legacy-owner-detected-handover-required');
    const owner=readJson(path.join(ownerAnchor(),'daemon.lock'),null);
    const stateOwner=readJson(path.join(config.stateDirectory,'daemon.lock'),null);
    if(owner?.pid!==process.pid||stateOwner?.pid!==process.pid)throw new Error('fresh-install-single-owner-proof-missing');
    return;
  }
  if (!config.ownerHandoverAcknowledged) throw new Error('explicit-owner-handover-required');
  if (path.resolve(config.stateDirectory).toLowerCase() === path.resolve(config.legacyStateDirectory).toLowerCase()) throw new Error('legacy-state-directory-must-remain-isolated');
  const control = readJson(path.join(config.legacyStateDirectory, 'control.json'), null);
  if (!control || control.enabled !== false) throw new Error('legacy-watchdog-must-be-paused-before-execution');
}

export class CodexAdapter {
  constructor(config) {
    this.config = config; this.official = new OfficialAppServerAdapter(config); this.desktop = new DesktopIpcAdapter(config);
    this.account = this.official; this.source = this.official.source; this.probe = new CompatibilityProbe(config);
    this.compatibility = { verified: false, safeMode: true, status: 'not-probed' };
    this.desktop.client.on('incompatible', () => { this.compatibility = { ...this.compatibility, verified: false, safeMode: true, status: 'protocol-changed' }; });
  }
  async connect() { await this.official.connect(); }
  probeCompatibility() { return this.compatibility = this.probe.inspect(); }
  readQuota() { return this.official.readQuota(); }
  listThreads(now) { return listRootThreads(this.config.codexHome, now); }
  isEligible(id) { return isRootThreadEligible(this.config.codexHome, id); }
  async snapshot(id) {
    if (!this.compatibility.verified) throw new Error('desktop-read-compatibility-unverified');
    await this.desktop.connect(); return this.desktop.snapshot(id);
  }
  unfollow(id) { this.desktop.unfollow(id); }
  verifyWriteSafety() {
    assertOwnerHandover(this.config);
    if (!this.compatibility.verified || !inspectBundle(this.config.asarPath).compatible) throw new Error('compatibility-safe-mode');
    verifyCurrentDesktop(this.config);
  }
  reopen(id) { this.verifyWriteSafety(); openExistingThread(id); }
  async doctor({ threadId } = {}) {
    const report = { compatibility: this.probeCompatibility(), checks: {}, source: this.source };
    const check = async (name, action) => { try { report.checks[name] = { status: 'passed', result: await action() }; } catch (error) { report.checks[name] = { status: 'failed', reason: error.message }; } };
    try {
      await check('protocol', async () => { await this.connect(); return { initialized: true }; });
      await check('quota', async () => { const quota=quotaStatus(await this.readQuota(),Date.now());if(!quota.known)throw new Error(quota.reason);return quota; });
      await check('modelCatalog', async () => { const models = await this.official.listModels(); return { count: models.length, models: models.map(m => ({ id: m.id, model: m.model, displayName: m.displayName, supportedReasoningEfforts: m.supportedReasoningEfforts })) }; });
      if (threadId) {
        if (!isUuid(threadId)) throw new Error('invalid-thread-id');
        await check('threadRead', async () => { const result = await this.official.readThread(threadId); return { found: !!result.thread, turns: result.thread?.turns?.length ?? null }; });
        await check('goalRead', async () => { const { goal } = await this.official.getGoal(threadId); return { present: goal != null, status: goal?.status ?? null }; });
        await check('dryRunResume', async () => { const { state } = await this.snapshot(threadId); const decision = assess(state, { catalogPersistent: true }); return { performedMutation: false, decision: decision.action, reason: decision.reason ?? null, compatible: report.compatibility.verified }; });
      } else for (const name of ['threadRead','goalRead','dryRunResume']) report.checks[name] = { status: 'not-run', reason: 'select-existing-thread-id' };
      return report;
    } finally { if (threadId) this.unfollow(threadId); }
  }
  async close() { this.desktop.close(); await this.official.close(); }
}
