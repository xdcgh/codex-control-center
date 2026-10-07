import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { setDefaultResultOrder } from 'node:dns';
setDefaultResultOrder('ipv4first');

const root=path.resolve(import.meta.dirname,'..'),output=path.join(root,'.packaged');
const PINNED_NODE='v24.21.0';
if(process.version!==PINNED_NODE||process.platform!=='win32'||process.arch!=='x64')throw new Error(`packaging-requires-node-${PINNED_NODE}-windows-x64`);
fs.mkdirSync(output,{recursive:true});
fs.copyFileSync(process.execPath,path.join(output,'node.exe'));
const sourceLicense=path.join(path.dirname(process.execPath),'LICENSE');
if(fs.existsSync(sourceLicense))fs.copyFileSync(sourceLicense,path.join(output,'node-LICENSE'));
else if(!fs.existsSync(path.join(output,'node-LICENSE'))) {
 const license=await fetch('https://raw.githubusercontent.com/nodejs/node/v24.21.0/LICENSE');if(!license.ok)throw new Error('node-license-unavailable');fs.writeFileSync(path.join(output,'node-LICENSE'),await license.text());
}
// Only reviewed source is packaged. Never copy runtime, auth, tests, diagnostics or .codex.
fs.cpSync(path.join(root,'src'),path.join(output,'core','src'),{recursive:true});
fs.copyFileSync(path.join(root,'pricing.json'),path.join(output,'core','pricing.json'));
fs.mkdirSync(path.join(output,'core','scripts'),{recursive:true});
for(const name of ['Get-DesktopOwner.ps1','Check-OwnerAnchor.ps1','Inspect-OwnerLease.ps1','Control-Autostart.ps1','discover-config.mjs'])fs.copyFileSync(path.join(root,'scripts',name),path.join(output,'core','scripts',name));
fs.writeFileSync(path.join(output,'core','package.json'),JSON.stringify({type:'module',name:'codex-control-center-sidecar',version:'0.1.0'}));
const sha=createHash('sha256').update(fs.readFileSync(path.join(output,'node.exe'))).digest('hex');
const checksumFile=path.join(output,'node-SHASUMS256.txt');let checksumText;
if(fs.existsSync(checksumFile))checksumText=fs.readFileSync(checksumFile,'utf8');
else {const checksums=await fetch('https://nodejs.org/dist/v24.21.0/SHASUMS256.txt');if(!checksums.ok)throw new Error('official-node-checksums-unavailable');checksumText=await checksums.text();fs.writeFileSync(checksumFile,checksumText);}
const official=checksumText.split('\n').find(line=>/\s+win-x64\/node[.]exe\s*$/.test(line))?.split(/\s+/)[0];
if(official!==sha)throw new Error('packaged-node-official-sha256-mismatch');
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({nodeVersion:PINNED_NODE,nodeSha256:sha,platform:'win32-x64',source:'https://nodejs.org/dist/v24.21.0/'}));
console.log(JSON.stringify({prepared:true,nodeVersion:PINNED_NODE,nodeSha256:sha}));
