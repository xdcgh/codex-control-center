import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { acquireLock, atomicWrite, readJson, StateStore } from '../src/store.mjs';

function temporary(t) {
  const prefix = path.join(fs.realpathSync(os.tmpdir()), 'codex-watchdog-test-');
  const directory = fs.mkdtempSync(prefix);
  t.after(() => {
    const target = fs.realpathSync(directory);
    if (!target.toLowerCase().startsWith(prefix.toLowerCase())) throw new Error('test-cleanup-outside-owned-prefix');
    fs.rmSync(target, { recursive: true, force: true });
  });
  return directory;
}
test('atomic replacement persists records and a permanent delivery ledger', (t) => {
  const directory = temporary(t), store = new StateStore(directory);
  const value = store.load(); value.ledger.a = { phase: 'uncertain' }; store.save(value);
  value.records.b = { phase: 'waitingQuota' }; store.save(value);
  assert.equal(new StateStore(directory).load().ledger.a.phase, 'uncertain');
  assert.equal(new StateStore(directory).load().records.b.phase, 'waitingQuota');
  assert.equal(fs.readdirSync(directory).filter((name) => name.endsWith('.tmp')).length, 0);
});
test('a second daemon cannot claim a live lock; release removes only its own lock', (t) => {
  const directory = temporary(t); const release = acquireLock(directory);
  assert.throws(() => acquireLock(directory), /already-running/);
  release(); const next = acquireLock(directory); next();
  assert.equal(fs.existsSync(path.join(directory, 'daemon.lock')), false);
});
test('corrupt state is preserved and never treated as a clean first run', (t) => {
  const directory = temporary(t); const file = path.join(directory, 'state.json');
  fs.writeFileSync(file, '{broken');
  assert.throws(() => new StateStore(directory).load(), /invalid-state-file/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
});
test('control changes use actual UTF-8 JSON without a BOM', (t) => {
  const directory = temporary(t); const file = path.join(directory, 'control.json');
  atomicWrite(file, { enabled: true, text: '继续' });
  assert.deepEqual(readJson(file), { enabled: true, text: '继续' });
});
