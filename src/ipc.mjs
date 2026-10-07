import net from 'node:net';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { SUPPORTED } from './bundle.mjs';

export const MAX_FRAME = 32 * 1024 * 1024;
export function frame(value) {
  const data = Buffer.from(JSON.stringify(value), 'utf8');
  if (!data.length || data.length > MAX_FRAME) throw new Error('ipc-frame-too-large');
  const prefix = Buffer.alloc(4); prefix.writeUInt32LE(data.length);
  return Buffer.concat([prefix, data]);
}
export class FrameReader {
  constructor(callback) { this.callback = callback; this.buffer = Buffer.alloc(0); }
  push(bytes) {
    this.buffer = Buffer.concat([this.buffer, bytes]);
    for (;;) {
      if (this.buffer.length < 4) return;
      const size = this.buffer.readUInt32LE();
      if (!size || size > MAX_FRAME) throw new Error('ipc-invalid-frame-size');
      if (this.buffer.length < size + 4) return;
      const body = this.buffer.subarray(4, size + 4);
      this.buffer = this.buffer.subarray(size + 4);
      const value = JSON.parse(body.toString('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ipc-invalid-message');
      this.callback(value);
    }
  }
}

export class DesktopClient extends EventEmitter {
  constructor({ pipe = '\\\\.\\pipe\\codex-ipc', timeoutMs = 10000 } = {}) {
    super(); this.pipe = pipe; this.timeoutMs = timeoutMs; this.clientId = 'initializing-client';
    this.pending = new Map(); this.following = new Map(); this.generations = new Map(); this.socket = null;
  }
  async connect() {
    if (this.socket) return;
    const socket = net.createConnection(this.pipe); this.socket = socket;
    const reader = new FrameReader((message) => this.receive(message));
    socket.on('data', (bytes) => { try { reader.push(bytes); } catch { socket.destroy(); this.rejectAll('ipc-protocol-error'); } });
    socket.on('error', () => this.rejectAll('desktop-unavailable'));
    socket.on('close', () => { this.socket = null; this.following.clear(); this.rejectAll('desktop-disconnected'); this.emit('disconnected'); });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.destroy(); reject(new Error('desktop-connect-timeout')); }, this.timeoutMs);
      socket.once('connect', () => { clearTimeout(timer); resolve(); });
      socket.once('error', () => { clearTimeout(timer); reject(new Error('desktop-unavailable')); });
    });
    const response = await this.request('initialize', { clientType: 'codex-quota-watchdog' });
    if (typeof response.result?.clientId !== 'string') throw new Error('ipc-initialization-invalid');
    this.clientId = response.result.clientId;
  }
  send(message) {
    if (!this.socket?.writable) throw new Error('desktop-unavailable');
    this.socket.write(frame(message));
  }
  request(method, params, targetClientId) {
    if (!['initialize', 'thread-owner-discovery', 'thread-follower-start-turn'].includes(method)) throw new Error('ipc-method-not-allowed');
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error(method === 'thread-follower-start-turn' ? 'delivery-uncertain' : 'ipc-query-timeout')); }, this.timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer, method });
      try { this.send({ type: 'request', requestId, sourceClientId: this.clientId,
        method, params, version: SUPPORTED.versions[method], timeoutMs: this.timeoutMs,
        ...(targetClientId ? { targetClientId } : {}) }); }
      catch (error) { clearTimeout(timer); this.pending.delete(requestId); reject(error); }
    });
  }
  broadcast(method, params, owner) {
    if (method !== 'thread-stream-following-changed') throw new Error('ipc-broadcast-not-allowed');
    this.send({ type: 'broadcast', sourceClientId: this.clientId, targetClientIds: [owner],
      method, version: SUPPORTED.versions[method], params });
  }
  receive(message) {
    if (message.type === 'client-discovery-request') {
      this.send({ type: 'client-discovery-response', requestId: message.requestId, response: { canHandle: false } });
      return;
    }
    if (message.type === 'request') {
      this.send({ type: 'response', requestId: message.requestId, resultType: 'error', error: 'unsupported-by-quota-watchdog' });
      return;
    }
    if (message.type === 'response') {
      const pending = this.pending.get(message.requestId); if (!pending) return;
      this.pending.delete(message.requestId); clearTimeout(pending.timer);
      if (message.resultType !== 'success') pending.reject(new Error(['no-client-found', 'request-version-mismatch', 'client-disconnected'].includes(message.error) ? message.error : (pending.method === 'thread-follower-start-turn' ? 'delivery-uncertain' : 'ipc-request-rejected')));
      else if (message.method !== pending.method) pending.reject(new Error('ipc-response-method-mismatch'));
      else pending.resolve(message);
      return;
    }
    if (message.type === 'broadcast' && message.method === 'thread-stream-state-changed') {
      const { conversationId, hostId, change } = message.params ?? {};
      if (hostId !== 'local' || this.following.get(conversationId) !== message.sourceClientId) return;
      if (message.version !== SUPPORTED.versions['thread-stream-state-changed']) { this.emit('incompatible'); return; }
      this.generations.set(conversationId, this.getGeneration(conversationId) + 1);
      if (change?.type === 'snapshot' && change.conversationState?.id === conversationId) this.emit('snapshot', conversationId, change.conversationState, message.sourceClientId);
      else this.emit('changed', conversationId);
    }
  }
  async snapshot(threadId) {
    const response = await this.request('thread-owner-discovery', { hostId: 'local', conversationId: threadId });
    const owner = response.handledByClientId;
    if (typeof owner !== 'string') throw new Error('ipc-missing-thread-owner');
    const previousOwner = this.following.get(threadId);
    if (previousOwner && previousOwner !== owner) this.unfollow(threadId);
    this.following.set(threadId, owner);
    return new Promise((resolve, reject) => {
      const clean = () => { clearTimeout(timer); this.off('snapshot', onSnapshot); this.off('disconnected', onClose); };
      const onSnapshot = (id, state, source) => { if (id === threadId && source === owner) { clean(); resolve({ state, owner, generation: this.getGeneration(id) }); } };
      const onClose = () => { clean(); reject(new Error('desktop-disconnected')); };
      const timer = setTimeout(() => { clean(); reject(new Error('desktop-snapshot-timeout')); }, this.timeoutMs);
      this.on('snapshot', onSnapshot); this.on('disconnected', onClose);
      try {
        this.broadcast('thread-stream-following-changed', { hostId: 'local', conversationId: threadId, following: false }, owner);
        this.broadcast('thread-stream-following-changed', { hostId: 'local', conversationId: threadId, following: true }, owner);
      } catch (error) { clean(); reject(error); }
    });
  }
  unfollow(threadId) {
    const owner = this.following.get(threadId);
    if (owner && this.socket?.writable) this.broadcast('thread-stream-following-changed', { hostId: 'local', conversationId: threadId, following: false }, owner);
    this.following.delete(threadId);
  }
  getGeneration(threadId) { return this.generations.get(threadId) ?? 0; }
  rejectAll(code) { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error(p.method === 'thread-follower-start-turn' ? 'delivery-uncertain' : code)); } this.pending.clear(); }
  close() { for (const id of this.following.keys()) this.unfollow(id); this.socket?.destroy(); this.rejectAll('desktop-client-closed'); }
}
