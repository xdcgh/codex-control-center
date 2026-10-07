import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  try { fs.renameSync(temporary, file); }
  catch (error) { fs.rmSync(temporary, { force: true }); throw error; }
}

export function readJson(file, missingValue) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return missingValue; throw new Error(`invalid-state-file:${path.basename(file)}`); }
}

export class StateStore {
  constructor(directory) { this.directory = directory; this.file = path.join(directory, 'state.json'); }
  load() {
    const value = readJson(this.file, { schemaVersion: 1, startedAt: null, records: {}, ledger: {} });
    if (value.schemaVersion !== 1 || !value.records || !value.ledger || typeof value.records !== 'object' || typeof value.ledger !== 'object') throw new Error('unsupported-watchdog-state');
    return value;
  }
  save(value) { value.updatedAt = new Date().toISOString(); atomicWrite(this.file, value); }
}

export function acquireLock(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'daemon.lock');
  const token = randomUUID();
  const claim = () => {
    const fd = fs.openSync(file, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token, startedAt: new Date().toISOString() })); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
  };
  try { claim(); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const owner = readJson(file);
    if (!Number.isSafeInteger(owner?.pid) || owner.pid <= 0) throw new Error('watchdog-lock-invalid');
    let alive = true;
    try { process.kill(owner.pid, 0); } catch (checkError) { if (checkError.code === 'ESRCH') alive = false; }
    if (alive) throw new Error('watchdog-already-running');
    // Remove only this exact stale lock; never remove the state directory or ledger.
    fs.unlinkSync(file); claim();
  }
  return () => { const owner = readJson(file, null); if (owner?.token === token) fs.unlinkSync(file); };
}

export function makeLogger(directory) {
  const file = path.join(directory, 'events.jsonl');
  return (event, fields = {}) => {
    fs.mkdirSync(directory, { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size > 2 * 1024 * 1024) {
      fs.renameSync(file, path.join(directory, `events-${Date.now()}.jsonl`));
    }
    fs.appendFileSync(file, JSON.stringify({ time: new Date().toISOString(), event, ...fields }) + '\n', { mode: 0o600 });
  };
}
