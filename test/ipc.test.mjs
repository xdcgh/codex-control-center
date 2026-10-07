import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { frame, FrameReader, DesktopClient, MAX_FRAME } from '../src/ipc.mjs';
import { task, THREAD } from './fixtures.mjs';

test('framing preserves split Unicode, partial headers and coalesced frames', () => {
  const results = []; const reader = new FrameReader((value) => results.push(value));
  const messages = [{ text: '恢复目标🙂' }, { value: 2 }];
  const wire = Buffer.concat(messages.map(frame));
  for (const byte of wire) reader.push(Buffer.from([byte]));
  assert.deepEqual(results, messages);
  const second = []; new FrameReader((value) => second.push(value)).push(wire);
  assert.deepEqual(second, messages);
});
test('zero/oversized frame announcements are rejected before allocating the body', () => {
  for (const size of [0, MAX_FRAME + 1]) {
    const bytes = Buffer.alloc(4); bytes.writeUInt32LE(size);
    assert.throws(() => new FrameReader(() => {}).push(bytes), /invalid-frame-size/);
  }
});
test('desktop follower requests a fresh snapshot and refuses approval ownership', async (t) => {
  const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\CodexQuotaWatchdogTest-${randomUUID()}` : `/tmp/codex-watchdog-${randomUUID()}.sock`;
  let approvalReply; let discoveryReply; const connections = new Set();
  const server = net.createServer((socket) => {
    connections.add(socket); socket.on('error', () => {}); socket.on('close', () => connections.delete(socket));
    socket.on('data', (bytes) => reader.push(bytes));
    const reader = new FrameReader((message) => {
      if (message.type === 'request') {
        if (message.method === 'initialize') {
          socket.write(frame({ type: 'response', method: message.method, requestId: message.requestId, resultType: 'success', result: { clientId: 'test-follower' } }));
          socket.write(frame({ type: 'client-discovery-request', requestId: 'discover' }));
          socket.write(frame({ type: 'request', requestId: 'approval', method: 'thread-follower-command-approval-decision', params: {} }));
        } else if (message.method === 'thread-owner-discovery') socket.write(frame({ type: 'response', method: message.method, requestId: message.requestId, resultType: 'success', handledByClientId: 'owner', result: {} }));
      }
      if (message.type === 'client-discovery-response') discoveryReply = message.response;
      if (message.type === 'response' && message.requestId === 'approval') approvalReply = message;
      if (message.type === 'broadcast' && message.params?.following) socket.write(frame({ type: 'broadcast', sourceClientId: 'owner', version: 11, method: 'thread-stream-state-changed', params: { conversationId: THREAD, hostId: 'local', change: { type: 'snapshot', conversationState: task() } } }));
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(endpoint, resolve); });
  const client = new DesktopClient({ pipe: endpoint, timeoutMs: 1000 });
  t.after(async () => { client.close(); for (const socket of connections) socket.destroy(); await new Promise((resolve) => server.close(resolve)); });
  await client.connect(); const snapshot = await client.snapshot(THREAD);
  assert.equal(snapshot.owner, 'owner'); assert.equal(snapshot.state.id, THREAD); assert.equal(snapshot.generation, 1);
  assert.deepEqual(discoveryReply, { canHandle: false });
  assert.equal(approvalReply.resultType, 'error');
  assert.throws(() => client.request('thread-follower-command-approval-decision', {}), /not-allowed/);
});
