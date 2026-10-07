#!/usr/bin/env node
// Read-only equality audit for an extracted installer payload and portable directory.
// Expected use: node scripts/verify-installed-payload.mjs --installed DIR --portable DIR
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const OFFICIAL_NODE_VERSION = 'v24.21.0';
const OFFICIAL_NODE_SHA256 = 'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32';
function option(name) { const i = args.indexOf(name); return i < 0 ? null : args[i + 1] ?? null; }
const installed = option('--installed'), portable = option('--portable');
if (!installed || !portable || args.length !== 4) throw new Error('usage: --installed DIR --portable DIR');
const roots = { installed: fs.realpathSync(installed), portable: fs.realpathSync(portable) };
for (const [name, root] of Object.entries(roots)) if (!fs.statSync(root).isDirectory()) throw new Error(`${name}-not-directory`);
if (roots.installed.toLowerCase() === roots.portable.toLowerCase()) throw new Error('directories-must-differ');

function inventory(root) {
  const files = new Map(), failures = [];
  const visit = (directory, prefix = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(directory, entry.name);
      const info = fs.lstatSync(full);
      if (info.isSymbolicLink() || info.isReparsePoint?.()) { failures.push(`link:${relative}`); continue; }
      if (entry.isDirectory()) visit(full, relative);
      else if (entry.isFile()) {
        const key = relative.toLowerCase();
        if (files.has(key)) failures.push(`case-collision:${relative}`);
        else files.set(key, { relative, full, size: info.size });
      } else failures.push(`unsupported-entry:${relative}`);
    }
  };
  visit(root);
  return { files, failures };
}
function fileHash(file) {
  const hash = createHash('sha256');
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(file);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
function markerCount(buffer, marker) {
  const needle = Buffer.from(marker, 'ascii'); let count = 0, offset = 0;
  while ((offset = buffer.indexOf(needle, offset)) >= 0) { count++; offset += needle.length; }
  return count;
}
function normalizedExecutable(file, from, to) {
  const bytes = fs.readFileSync(file), source = Buffer.from(from, 'ascii'), destination = Buffer.from(to, 'ascii');
  const sourceCount = markerCount(bytes, from), targetCount = markerCount(bytes, to);
  if (source.length !== destination.length || sourceCount !== 1 || targetCount !== 0) return { ok: false, sourceCount, targetCount, sha256: null };
  const offset = bytes.indexOf(source); bytes.set(destination, offset);
  return { ok: true, sourceCount, targetCount, sha256: createHash('sha256').update(bytes).digest('hex') };
}
function parseJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
const privatePathPatterns = [
  /[A-Z]:\\Users\\[^\\\x00]{1,120}\\[^\\\x00]{1,240}/gi,
  /[A-Z]:\\Documents and Settings\\[^\\\x00]{1,120}\\[^\\\x00]{1,240}/gi,
  /[A-Z]:\\(?:[^\\\x00]{1,120}\\){1,8}AppData\\[^\\\x00]{1,240}/gi,
];
function privateAbsolutePathOccurrences(bytes) {
  const texts = [bytes.toString('latin1'), bytes.toString('utf16le')]; let count = 0;
  for (const text of texts) for (const pattern of privatePathPatterns) {
    pattern.lastIndex = 0;
    while (pattern.exec(text)) count++;
  }
  return count;
}
function verifyPathScanner() {
  const sep = String.fromCharCode(92), sample = ['Z:', 'Users', 'fixture-profile', 'AppData', 'Local', 'build-cache'].join(sep);
  if (!privateAbsolutePathOccurrences(Buffer.from(sample, 'ascii')) || !privateAbsolutePathOccurrences(Buffer.from(sample, 'utf16le'))) throw new Error('private-path-scanner-self-test-failed');
}
verifyPathScanner();

const a = inventory(roots.installed), b = inventory(roots.portable), failures = [...a.failures, ...b.failures];
const portableMetadata = new Set(['.control-center-run-artifact', 'manifest.json', 'run-manifest.json', 'readme', 'readme.md', 'readme.txt']);
const installerExtras = new Set(['uninstall.exe']);
const payloadA = new Map([...a.files].filter(([key]) => !installerExtras.has(key)));
const payloadB = new Map([...b.files].filter(([key]) => !portableMetadata.has(key)));
const missingFromInstaller = [...payloadB].filter(([key]) => !payloadA.has(key)).map(([, item]) => item.relative);
const missingFromPortable = [...payloadA].filter(([key]) => !payloadB.has(key)).map(([, item]) => item.relative);
failures.push(...missingFromInstaller.map(name => `missing-installed:${name}`), ...missingFromPortable.map(name => `missing-portable:${name}`));

const exeKey = 'codex-control-center.exe', exeA = payloadA.get(exeKey), exeB = payloadB.get(exeKey);
const markerNss = '__TAURI_BUNDLE_TYPE_VAR_NSS', markerUnk = '__TAURI_BUNDLE_TYPE_VAR_UNK';
let executable = { ok: false, installed: null, portable: null, normalizedMatch: false };
if (exeA && exeB) {
  const normalizedA = normalizedExecutable(exeA.full, markerNss, markerUnk);
  // Portable carries exactly one UNK marker; compare it with the installed binary after its sole NSS substitution.
  const portableBytes = fs.readFileSync(exeB.full);
  const portableUnkCount = markerCount(portableBytes, markerUnk), portableNssCount = markerCount(portableBytes, markerNss);
  const installedHash = await fileHash(exeA.full), portableHash = await fileHash(exeB.full);
  executable = { ok: normalizedA.ok && portableUnkCount === 1 && portableNssCount === 0,
    installedSha256: installedHash, portableSha256: portableHash,
    installedNssMarkerCount: normalizedA.sourceCount, installedUnexpectedUnkMarkerCount: normalizedA.targetCount,
    portableUnkMarkerCount: portableUnkCount, portableUnexpectedNssMarkerCount: portableNssCount,
    normalizedSha256: normalizedA.sha256,
    normalizedMatch: normalizedA.ok && normalizedA.sha256 === portableHash };
  if (!executable.ok || !executable.normalizedMatch) failures.push('main-executable-has-unexpected-difference');
}

const exactMatches = [];
for (const [key, itemA] of payloadA) {
  if (key === exeKey) continue;
  const itemB = payloadB.get(key); if (!itemB) continue;
  const [hashA, hashB] = await Promise.all([fileHash(itemA.full), fileHash(itemB.full)]);
  if (itemA.size !== itemB.size || hashA !== hashB) failures.push(`payload-bytes-differ:${itemA.relative}`);
  else exactMatches.push(itemA.relative);
}

const required = ['node.exe', 'node-license', 'license', 'third_party_licenses.txt', 'third_party_notices.md', 'core/pricing.json', 'core/src/core-cli.mjs', 'core/scripts/read-systemproxy.ps1'];
for (const key of required) if (!payloadA.has(key) || !payloadB.has(key)) failures.push(`required-payload-missing:${key}`);
const powershellScripts = [...payloadA.keys()].filter(key => key.startsWith('core/scripts/') && key.endsWith('.ps1')).length;
if (powershellScripts !== 5) failures.push(`unexpected-powershell-script-count:${powershellScripts}`);

const nodeManifest = b.files.get('manifest.json');
const runManifest = b.files.get('run-manifest.json');
let manifestOk = false, nodeSha256 = null;
try {
  const node = parseJson(nodeManifest.full), run = parseJson(runManifest.full), nodeEntry = payloadA.get('node.exe');
  nodeSha256 = await fileHash(nodeEntry.full);
  manifestOk = node.nodeVersion === OFFICIAL_NODE_VERSION && run.node?.nodeVersion === node.nodeVersion && node.nodeSha256 === run.node.nodeSha256 && nodeSha256 === node.nodeSha256 && nodeSha256 === OFFICIAL_NODE_SHA256 && executable.normalizedMatch && executable.portableSha256 === run.exeSha256;
} catch { manifestOk = false; }
if (!manifestOk) failures.push('runtime-manifest-mismatch');

const privateNamePattern = /(^|\/)(?:config\.json|owner\.json|daemon\.lock|state\.json|[^/]+\.(?:db|sqlite|sqlite3|jsonl|log)(?:-(?:wal|shm))?|auth(?:\.json)?|credentials?(?:\.json)?|\.codex|sessions|diagnostics|logs|users|appdata)(\/|$)/i;
const allFiles = [...a.files.values(), ...b.files.values()];
const privateNameMatches = [...new Set(allFiles.filter(item => privateNamePattern.test(item.relative)).map(item => item.relative.toLowerCase()))];
let privateAbsolutePathLeakFiles = 0, privateAbsolutePathLeakOccurrences = 0;
for (const item of allFiles) {
  const count = privateAbsolutePathOccurrences(fs.readFileSync(item.full));
  if (count) { privateAbsolutePathLeakFiles++; privateAbsolutePathLeakOccurrences += count; }
}
if (privateNameMatches.length) failures.push(`sensitive-payload-names:${privateNameMatches.length}`);
if (privateAbsolutePathLeakOccurrences) failures.push(`private-absolute-path-content:${privateAbsolutePathLeakOccurrences}`);

const result = { status: failures.length ? 'FAIL' : 'PASS', installedPayloadFiles: payloadA.size, portablePayloadFiles: payloadB.size,
  exactNonMainFiles: exactMatches.length, mainExeMarkerOnlyDifference: executable.normalizedMatch,
  mainExe: executable, nodeVersion: OFFICIAL_NODE_VERSION, nodeSha256, nodeMatchesOfficialDigest: nodeSha256 === OFFICIAL_NODE_SHA256, manifestMatches: manifestOk,
  licenseFilesPresent: ['LICENSE', 'node-LICENSE', 'THIRD_PARTY_LICENSES.txt', 'THIRD_PARTY_NOTICES.md'].every(name => payloadA.has(name.toLowerCase()) && payloadB.has(name.toLowerCase())),
  corePowerShellScriptCount: powershellScripts, suspiciousPathMatches: privateNameMatches.length,
  privateAbsolutePathLeakFiles, privateAbsolutePathLeakOccurrences, scannerSelfTest: true,
  failures };
process.stdout.write(JSON.stringify(result) + '\n');
if (failures.length) process.exitCode = 1;
