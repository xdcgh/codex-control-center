import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const SUPPORTED = Object.freeze({
  appVersion: '26.930.61225',
  cliVersion: '0.160.1',
  protocolHash: '5759fc581485ffbae068afedbdfd7067d8500bbe0272793458a13ac0d333b330',
  bootstrapHash: '1f726d0e3103d81501551546d3b6e70f1fc10646f9326e00fe68605f144c5f4f',
  versions: { initialize: 0, 'thread-owner-discovery': 1,
    'thread-stream-state-changed': 11, 'thread-stream-following-changed': 1,
    'thread-follower-start-turn': 2 },
});

export function inspectBundle(asarPath) {
  const fd = fs.openSync(asarPath, 'r');
  try {
    const prefix = Buffer.alloc(16);
    if (fs.readSync(fd, prefix, 0, 16, 0) !== 16) throw new Error('invalid-asar');
    const headerSize = prefix.readUInt32LE(4);
    const jsonSize = prefix.readUInt32LE(12);
    if (jsonSize < 2 || jsonSize > 16 * 1024 * 1024 || jsonSize > headerSize) throw new Error('invalid-asar-header');
    const bytes = Buffer.alloc(jsonSize);
    if (fs.readSync(fd, bytes, 0, jsonSize, 16) !== jsonSize) throw new Error('truncated-asar');
    const header = JSON.parse(bytes.toString('utf8'));
    const read = (name) => {
      let node = header;
      for (const segment of name.split('/')) node = node.files?.[segment];
      if (!node || node.unpacked || !Number.isSafeInteger(node.size) || node.size > 16 * 1024 * 1024) throw new Error('asar-entry-unavailable');
      const out = Buffer.alloc(node.size);
      if (fs.readSync(fd, out, 0, node.size, 8 + headerSize + Number(node.offset)) !== node.size) throw new Error('asar-entry-truncated');
      return out;
    };
    const build = header.files?.['.vite']?.files?.build?.files ?? {};
    const protocolName = Object.keys(build).find((name) => name === 'src-C1dW0Du8.js');
    const bootstrapName = Object.keys(build).find((name) => name.startsWith('bootstrap-') && name.endsWith('.js'));
    const app = JSON.parse(read('package.json').toString('utf8'));
    const hash = (value) => createHash('sha256').update(value).digest('hex');
    const protocolHash = protocolName ? hash(read(`.vite/build/${protocolName}`)) : null;
    const bootstrapHash = bootstrapName ? hash(read(`.vite/build/${bootstrapName}`)) : null;
    return { appVersion: app.version, protocolHash, bootstrapHash,
      compatible: app.version === SUPPORTED.appVersion && protocolHash === SUPPORTED.protocolHash && bootstrapHash === SUPPORTED.bootstrapHash,
      resourcesPath: path.dirname(asarPath) };
  } finally { fs.closeSync(fd); }
}
