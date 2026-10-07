import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { startBroker, MAX_MESSAGE_BYTES, MAX_CLIENTS } from '../src/core/broker.mjs';
import { assertOwnerHandover } from '../src/adapters/codex.mjs';
import { acquireLock } from '../src/store.mjs';

function connect(pipe) {
  const socket = net.createConnection(pipe);
  socket.on('error', () => {});
  return socket;
}
function connected(socket) { return new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); }); }
function closed(socket, ms = 2000, label = 'socket') {
  return Promise.race([
    new Promise(resolve => socket.once('close', resolve)),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`fixture-${label}-close-timeout`)), ms)),
  ]);
}
function rpcClient(pipe) {
  const socket = connect(pipe);
  let text = '';
  const queue = [];
  const waiters = [];
  socket.on('data', bytes => {
    text += bytes.toString('utf8');
    let at;
    while ((at = text.indexOf('\n')) >= 0) {
      const value = JSON.parse(text.slice(0, at));
      text = text.slice(at + 1);
      if (waiters.length) waiters.shift()(value); else queue.push(value);
    }
  });
  return {
    socket,
    next() { return queue.length ? Promise.resolve(queue.shift()) : new Promise(resolve => waiters.push(resolve)); },
    send(value) { socket.write(JSON.stringify(value) + '\n'); },
    sendLine(line) { socket.write(line + '\n'); },
  };
}
async function withBroker(action, { timeoutMs = 3000, nativeBin } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ccc-broker-acceptance-'));
  const stateDirectory = path.join(base, 'new-state');
  let calls = 0;
  const routed = [];
  const broker = await startBroker({ stateDirectory, timeoutMs, nativeBin, route: async request => {
    calls++;
    routed.push(request);
    return { owner: 'one-mock-core', sequence: calls, method: request.method, paddingLength: request.params?.padding?.length ?? 0 };
  } });
  try { await action({ base, stateDirectory, broker, routed, calls: () => calls }); }
  finally { await broker.close(); fs.rmSync(base, { recursive: true, force: true }); }
}
function exactLengthRequest(id, targetBodyBytes) {
  const value = { id, method: 'snapshot', params: { padding: '' } };
  const base = JSON.stringify(value);
  const count = targetBodyBytes - Buffer.byteLength(base);
  if (count < 0) throw new Error('invalid-fixture-target-size');
  value.params.padding = 'x'.repeat(count);
  const line = JSON.stringify(value);
  assert.equal(Buffer.byteLength(line), targetBodyBytes);
  return line;
}

test('unauthenticated and wrong-token requests never reach the shared router or echo credentials', async () => {
  await withBroker(async ({ base, stateDirectory, broker, calls }) => {
    const legacy = path.join(base, 'legacy-runtime');
    fs.mkdirSync(legacy);
    const marker = path.join(legacy, 'control.json');
    const original = JSON.stringify({ enabled: true, marker: 'SYNTH_LEGACY_SENTINEL' });
    fs.writeFileSync(marker, original);

    const noToken = connect(JSON.parse(fs.readFileSync(broker.descriptorPath, 'utf8')).pipe);
    await connected(noToken);
    let noTokenResponse = '';
    noToken.on('data', bytes => { noTokenResponse += bytes.toString('utf8'); });
    const noTokenClosed = closed(noToken, 2000, 'unauthenticated');
    noToken.write(JSON.stringify({ id: 'anonymous', method: 'snapshot' }) + '\n');
    try { await noTokenClosed; } catch { throw new Error(`unauthenticated-no-close-response-bytes-${Buffer.byteLength(noTokenResponse)}-routes-${calls()}`); }

    const descriptor = JSON.parse(fs.readFileSync(broker.descriptorPath, 'utf8'));
    const wrong = 'a'.repeat(64);
    const bad = connect(descriptor.pipe);
    await connected(bad);
    let responseText = '';
    bad.on('data', bytes => { responseText += bytes.toString('utf8'); });
    const badClosed = closed(bad, 2000, 'wrong-token');
    bad.write(JSON.stringify({ id: 2, method: 'authenticate', params: { token: wrong } }) + '\n');
    await badClosed;
    assert.equal(calls(), 0);
    assert.equal(responseText.includes(wrong), false);
    assert.equal(responseText.includes(descriptor.token), false);
    assert.equal(fs.readFileSync(marker, 'utf8'), original);
    assert.notEqual(path.resolve(broker.descriptorPath).toLowerCase(), path.resolve(marker).toLowerCase());
  });
});

test('authenticated shared owner routes once per request, correlates clients, and enforces per-line size', async () => {
  await withBroker(async ({ broker, calls, routed }) => {
    const descriptor = JSON.parse(fs.readFileSync(broker.descriptorPath, 'utf8'));
    const left = rpcClient(descriptor.pipe), right = rpcClient(descriptor.pipe);
    await Promise.all([connected(left.socket), connected(right.socket)]);
    left.send({ id: 'auth-left', method: 'authenticate', params: { token: descriptor.token } });
    right.send({ id: 'auth-right', method: 'authenticate', params: { token: descriptor.token } });
    const greetings = await Promise.all([left.next(), right.next()]);
    assert.deepEqual(greetings.map(x => x.result?.authenticated), [true, true]);
    assert.equal(JSON.stringify(greetings).includes(descriptor.token), false);

    left.send({ id: 'left-1', method: 'snapshot' });
    right.send({ id: 'right-1', method: 'events/list' });
    const results = await Promise.all([left.next(), right.next()]);
    assert.deepEqual(results.map(x => x.id), ['left-1', 'right-1']);
    assert.deepEqual(results.map(x => x.result.owner), ['one-mock-core', 'one-mock-core']);
    assert.equal(calls(), 2);

    const exact = exactLengthRequest('max-valid', MAX_MESSAGE_BYTES - 1);
    left.sendLine(exact);
    const accepted = await left.next();
    assert.equal(accepted.id, 'max-valid');
    assert.equal(accepted.result.paddingLength > 0, true);
    assert.equal(calls(), 3);

    const tooLong = exactLengthRequest('too-long', MAX_MESSAGE_BYTES);
    const socketClosed = closed(left.socket);
    left.sendLine(tooLong);
    await socketClosed;
    assert.equal(calls(), 3);
    right.socket.destroy();
  });
});

test('valid coalesced lines are handled individually, while idle and excess clients are closed', async () => {
  await withBroker(async ({ broker, calls }) => {
    const descriptor = JSON.parse(fs.readFileSync(broker.descriptorPath, 'utf8'));
    const c = rpcClient(descriptor.pipe);
    await connected(c.socket);
    c.send({ id: 'auth', method: 'authenticate', params: { token: descriptor.token } });
    await c.next();
    const a = JSON.stringify({ id: 'batch-a', method: 'snapshot', params: { padding: 'a'.repeat(35000) } });
    const b = JSON.stringify({ id: 'batch-b', method: 'events/list', params: { padding: 'b'.repeat(35000) } });
    assert.equal(Buffer.byteLength(a) < MAX_MESSAGE_BYTES, true);
    assert.equal(Buffer.byteLength(b) < MAX_MESSAGE_BYTES, true);
    c.socket.cork(); c.socket.write(a + '\n'); c.socket.write(b + '\n'); c.socket.uncork();
    const pair = await Promise.all([c.next(), c.next()]);
    assert.deepEqual(pair.map(x => x.id), ['batch-a', 'batch-b']);
    assert.equal(calls(), 2);
    c.socket.destroy();
  });

  await withBroker(async ({ broker, calls }) => {
    const pipe = JSON.parse(fs.readFileSync(broker.descriptorPath, 'utf8')).pipe;
    const clients = [];
    for (let i = 0; i < MAX_CLIENTS; i++) { const c = connect(pipe); clients.push(c); await connected(c); }
    const third = connect(JSON.parse(fs.readFileSync(broker.descriptorPath, 'utf8')).pipe);
    await closed(third, 2000, 'excess-client');
    assert.equal(MAX_CLIENTS, 8);
    assert.equal(calls(), 0);
    for (const c of clients) c.destroy();
  }, { timeoutMs: 5000 });

  await withBroker(async ({ broker, calls }) => {
    const idle = connect(JSON.parse(fs.readFileSync(broker.descriptorPath, 'utf8')).pipe);
    await connected(idle);
    await closed(idle, 1500, 'idle-client');
    assert.equal(calls(), 0);
  }, { timeoutMs: 60 });
});

test('broker directory and descriptor are limited to current SID and SYSTEM on Windows', async () => {
  if (process.platform !== 'win32') return;
  await withBroker(async ({ broker }) => {
    const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const aclAt = target => {
      const accessor = fs.statSync(target).isDirectory() ? 'Directory' : 'File';
      const literal = target.replaceAll("'", "''");
      const command = `$acl=[System.IO.${accessor}]::GetAccessControl('${literal}');$acl.Access | ForEach-Object { try { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value } catch {} }`;
      try { return execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, encoding: 'utf8', timeout: 8000 }).trim().split(/\r?\n/); }
      catch { throw new Error('fixture-acl-query-failed'); }
    };
    const currentSid = execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'], { windowsHide: true, encoding: 'utf8', timeout: 8000 }).trim();
    const systemSid = 'S-1-5-18';
    for (const target of [path.dirname(broker.descriptorPath), broker.descriptorPath]) {
      const sids = [...new Set(aclAt(target))];
      assert.equal(sids.includes(currentSid), true, `ACL SIDs: ${sids.join(',')}`);
      assert.equal(sids.includes(systemSid), true, `ACL SIDs: ${sids.join(',')}`);
      assert.equal(sids.includes('S-1-1-0'), false); // Everyone.
      assert.equal(sids.includes('S-1-5-32-545'), false); // Built-in Users.
    }
  });
});

test('fresh installs still require one owner lock and a clean legacy probe; migrated installs require handover', async t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ccc-owner-acceptance-'));
  const oldLocalAppData = process.env.LOCALAPPDATA;
  const localAppData = path.join(base, 'local-app-data');
  const stateDirectory = path.join(base, 'new-state');
  const legacyStateDirectory = path.join(base, 'legacy-state');
  fs.mkdirSync(legacyStateDirectory, { recursive: true });
  try {
    process.env.LOCALAPPDATA = localAppData;
    const fresh = { installationMode: 'fresh', stateDirectory };
    const ownerAnchor = () => path.join(localAppData, 'CodexControlCenter', 'owner');
    const probeCalls = [];
    const probe = proof => () => { probeCalls.push(proof); return proof; };
    assert.throws(() => assertOwnerHandover(fresh, { legacyProbe: probe({ legacyTaskPresent: true, legacyProcesses: 0 }), ownerAnchor }), /legacy-owner-detected/);
    assert.throws(() => assertOwnerHandover(fresh, { legacyProbe: probe({ legacyTaskPresent: false, legacyProcesses: 1 }), ownerAnchor }), /legacy-owner-detected/);
    assert.equal(probeCalls.length, 2);

    const ownerRelease = acquireLock(path.join(localAppData, 'CodexControlCenter', 'owner'));
    const stateRelease = acquireLock(stateDirectory);
    try {
      assert.throws(() => acquireLock(path.join(localAppData, 'CodexControlCenter', 'owner')), /watchdog-already-running/);
      assert.throws(() => acquireLock(stateDirectory), /watchdog-already-running/);
      assert.doesNotThrow(() => assertOwnerHandover(fresh, { legacyProbe: probe({ legacyTaskPresent: false, legacyProcesses: 0 }), ownerAnchor }));
    } finally { stateRelease(); ownerRelease(); }

    const control = path.join(legacyStateDirectory, 'control.json');
    const migrated = { installationMode: 'migrated', stateDirectory, legacyStateDirectory, ownerHandoverAcknowledged: true };
    fs.writeFileSync(control, JSON.stringify({ enabled: true }));
    assert.throws(() => assertOwnerHandover(migrated), /legacy-watchdog-must-be-paused/);
    fs.writeFileSync(control, JSON.stringify({ enabled: false }));
    assert.doesNotThrow(() => assertOwnerHandover(migrated));
  } finally {
    if (oldLocalAppData == null) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = oldLocalAppData;
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('Rust production helper authenticates locally, correlates the shared route, bounds lines, and caps concurrent clients', { skip: process.platform !== 'win32' || !process.env.CODEX_CONTROL_CENTER_NATIVE_TEST_HELPER }, async () => {
  const nativeBin = process.env.CODEX_CONTROL_CENTER_NATIVE_TEST_HELPER;
  await withBroker(async ({ broker, calls }) => {
    const descriptor = JSON.parse(fs.readFileSync(broker.descriptorPath, 'utf8'));
    assert.equal(descriptor.rejectRemoteClients, true);

    for (const auth of [null, 'a'.repeat(64)]) {
      const bad = connect(descriptor.pipe);
      await connected(bad);
      const didClose = closed(bad, 2000, auth ? 'native-wrong-token' : 'native-unauthenticated');
      bad.write(JSON.stringify(auth == null
        ? { id: 'anonymous', method: 'snapshot' }
        : { id: 'bad-auth', method: 'authenticate', params: { token: auth } }) + '\n');
      await didClose;
    }
    assert.equal(calls(), 0);

    const clients = [];
    const makeAuthenticated = async id => {
      const c = rpcClient(descriptor.pipe);
      clients.push(c);
      await connected(c.socket);
      c.send({ id: `auth-${id}`, method: 'authenticate', params: { token: descriptor.token } });
      const answer = await c.next();
      assert.equal(answer.id, `auth-${id}`);
      assert.equal(answer.result.authenticated, true);
      assert.equal(JSON.stringify(answer).includes(descriptor.token), false);
      return c;
    };

    const left = await makeAuthenticated('left');
    const right = await makeAuthenticated('right');
    left.send({ id: 'native-left', method: 'snapshot' });
    right.send({ id: 'native-right', method: 'events/list' });
    const pair = await Promise.all([left.next(), right.next()]);
    assert.deepEqual(pair.map(x => x.id), ['native-left', 'native-right']);
    assert.deepEqual(pair.map(x => x.result.owner), ['one-mock-core', 'one-mock-core']);
    assert.equal(calls(), 2);
    assert.equal(JSON.stringify(pair).includes(descriptor.token), false);

    left.sendLine(exactLengthRequest('native-max-valid', MAX_MESSAGE_BYTES - 1));
    assert.equal((await left.next()).id, 'native-max-valid');
    assert.equal(calls(), 3);
    const tooLong = closed(left.socket, 2000, 'native-frame-includes-newline-limit');
    left.sendLine(exactLengthRequest('native-frame-too-long', MAX_MESSAGE_BYTES));
    await tooLong;
    assert.equal(calls(), 3);

    for (let n = 0; n < MAX_CLIENTS - 1; n++) await makeAuthenticated(`slot-${n}`);
    for (let n = 0; n < MAX_CLIENTS; n++) clients[n + 1]?.send({ id: `slot-request-${n}`, method: 'snapshot' });
    for (let n = 0; n < MAX_CLIENTS; n++) {
      const c = clients[n + 1];
      const answer = await c.next();
      assert.equal(answer.id, `slot-request-${n}`);
    }
    const excess = connect(descriptor.pipe);
    await closed(excess, 2500, 'native-excess-client');
    assert.equal(calls(), 3 + MAX_CLIENTS);
  }, { nativeBin });
});
