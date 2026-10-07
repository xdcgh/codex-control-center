import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

// This client never resumes/owns a desktop thread and never starts a model turn.
const METHODS = new Set(['account/rateLimits/read', 'thread/goal/get', 'thread/goal/set']);
export class AccountClient {
  constructor({ codexBin, codexHome, timeoutMs = 20000 }) {
    this.options = { codexBin, codexHome, timeoutMs };
    this.pending = new Map(); this.counter = 0; this.buffer = ''; this.child = null; this.decoder = new StringDecoder('utf8');
  }
  async start() {
    if (this.child) return;
    const { codexBin, codexHome } = this.options;
    const child = spawn(codexBin, ['app-server', '--stdio'], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CODEX_HOME: codexHome },
    });
    this.child = child;
    child.stdin.on('error', () => this.rejectAll('account-pipe-closed'));
    child.stdout.on('data', (bytes) => this.read(bytes));
    child.stderr.on('data', () => {}); // Do not copy private app-server diagnostics into our logs.
    child.on('error', () => this.rejectAll('account-process-error'));
    child.on('exit', () => { this.child = null; this.rejectAll('account-process-exited'); });
    await this.raw('initialize', { clientInfo: { name: 'codex_quota_watchdog', title: 'Codex Quota Watchdog', version: '0.1.0' }, capabilities: { experimentalApi: false, requestAttestation: false } });
    this.send({ method: 'initialized' });
  }
  send(value) {
    if (!this.child?.stdin.writable) throw new Error('account-not-connected');
    this.child.stdin.write(JSON.stringify(value) + '\n');
  }
  raw(method, params) {
    const id = ++this.counter;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('account-query-timeout')); }, this.options.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, ...(params === undefined ? {} : { params }) }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  request(method, params) {
    if (!METHODS.has(method)) throw new Error('account-method-not-allowed');
    // Status restoration is the only permitted mutation. Keep objective/budget/accounting intact.
    if (method === 'thread/goal/set' && (params?.status !== 'active' || Object.keys(params).sort().join(',') !== 'status,threadId')) throw new Error('goal-update-not-allowed');
    return this.raw(method, params);
  }
  read(bytes) {
    this.buffer += this.decoder.write(bytes);
    if (this.buffer.length > 8 * 1024 * 1024) { this.rejectAll('account-response-too-large'); this.child?.kill(); return; }
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index); this.buffer = this.buffer.slice(index + 1);
      let message; try { message = JSON.parse(line); } catch { continue; }
      if (message.method) { this.onNotification?.(message); continue; }
      const waiter = this.pending.get(message.id);
      if (!waiter || message.method) continue;
      this.pending.delete(message.id); clearTimeout(waiter.timer);
      if (message.error) { this.onRpcError?.(message.error); waiter.reject(new Error(`account-rpc-${message.error.code ?? 'error'}`)); }
      else waiter.resolve(message.result);
    }
  }
  rejectAll(code) { for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(code)); } this.pending.clear(); }
  async close() {
    const child = this.child;
    if (!child) return;
    this.child = null; this.rejectAll('account-client-closed');
    child.stdin.end();
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      const timer = setTimeout(() => { child.kill(); resolve(); }, 1500);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
}
