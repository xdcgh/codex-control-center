import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const LEGACY = Object.freeze({
  appVersion: '26.930.61225',
  cliVersion: '0.160.1',
  protocolHash: '5759fc581485ffbae068afedbdfd7067d8500bbe0272793458a13ac0d333b330',
  bootstrapHash: '1f726d0e3103d81501551546d3b6e70f1fc10646f9326e00fe68605f144c5f4f',
  protocolName: 'src-C1dW0Du8.js',
  versions: { initialize: 0, 'thread-owner-discovery': 1,
    'thread-stream-state-changed': 11, 'thread-stream-following-changed': 1,
    'thread-follower-start-turn': 2 },
});

// Exact installed bundle hashes, generated CLI schemas and read-only required
// method probes verified together. Unknown releases remain mutation-disabled.
export const SUPPORTED = Object.freeze({
  appVersion: '26.1002.52244', cliVersion: '0.162.0-alpha.2',
  protocolName: 'src-BPM2XJL0.js',
  protocolHash: '0f43ea10acf2852395ba10a8a24838bc5646b8543197e8eeadd1e4fadea4c7b1',
  bootstrapHash: 'a70497f5ffa764fe74f4de7ac05a5f73aff8d1e2f44de4476d1d9a684af43ddd',
  versions: LEGACY.versions,
});
export const SUPPORTED_RELEASES = Object.freeze([SUPPORTED, LEGACY]);

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
    const app = JSON.parse(read('package.json').toString('utf8'));
    const release = SUPPORTED_RELEASES.find(entry => entry.appVersion === app.version);
    const protocolName = release?.protocolName;
    const bootstrapNames = Object.keys(build).filter(name => name.startsWith('bootstrap-') && name.endsWith('.js'));
    const bootstrapName = bootstrapNames.length === 1 ? bootstrapNames[0] : null;
    const hash = (value) => createHash('sha256').update(value).digest('hex');
    const protocolHash = protocolName && build[protocolName] ? hash(read(`.vite/build/${protocolName}`)) : null;
    const bootstrapHash = bootstrapName ? hash(read(`.vite/build/${bootstrapName}`)) : null;
    return { appVersion: app.version, protocolHash, bootstrapHash,
      compatible: !!release && protocolHash === release.protocolHash && bootstrapHash === release.bootstrapHash,
      supportedCliVersion: release?.cliVersion ?? null,
      resourcesPath: path.dirname(asarPath) };
  } finally { fs.closeSync(fd); }
}
