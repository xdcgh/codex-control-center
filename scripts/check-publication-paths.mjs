import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {buildEnvironment} from './build-desktop.mjs';
const CHUNK_BYTES=65536;
// Only ASCII bytes are case-folded. Never ask ICU to case-map arbitrary binary UTF-16.
const normalizeBytes=buffer=>{const result=Buffer.from(buffer);for(let i=0;i<result.length;i++){if(result[i]>=65&&result[i]<=90)result[i]+=32;else if(result[i]===92)result[i]=47;}return result;};
function utf16Ascii(buffer,offset){const result=Buffer.alloc(Math.floor((buffer.length-offset)/2));for(let i=offset,j=0;i+1<buffer.length;i+=2,j++)result[j]=buffer[i+1]===0?buffer[i]:0;return normalizeBytes(result).toString('latin1');}
export function scanPublicationFile(file,{roots=buildEnvironment().mappings,chunkBytes=CHUNK_BYTES}={}){
 if(!Number.isInteger(chunkBytes)||chunkBytes<16||chunkBytes>1048576)throw new Error('publication-invalid-chunk-size');
 const prefixes=roots.flatMap(root=>['utf8','utf16le'].map(encoding=>({rule:`build-root:${root.label}`,encoding,bytes:normalizeBytes(Buffer.from(root.source.replaceAll('\\','/'),encoding))})));
 const overlap=Math.max(2048,...prefixes.map(p=>p.bytes.length+2)),hits=new Map();const record=(encoding,rule)=>hits.set(`${encoding}:${rule}`,{encoding,rule});
 const rules=[['windows-profile',/[a-z]:\/users\/[^\s\x00\/]{1,256}\//],['windows-build-cache',/[a-z]:\/[^\x00\r\n]{0,160}\/(?:\.cargo|\.rustup|appdata)\//],['unix-profile',/\/(?:home|users)\/[^\s\x00\/]{1,256}\//]];
 const fd=fs.openSync(file,'r');let total=0,tail=Buffer.alloc(0);try{const chunk=Buffer.alloc(chunkBytes);for(;;){const length=fs.readSync(fd,chunk,0,chunk.length,null);if(!length)break;total+=length;const buffer=Buffer.concat([tail,chunk.subarray(0,length)]),folded=normalizeBytes(buffer);
  for(const prefix of prefixes)if(prefix.bytes.length&&folded.includes(prefix.bytes))record(prefix.encoding==='utf8'?'ASCII':'UTF16',prefix.rule);
  const views=[['ASCII',folded.toString('latin1')],['UTF16',utf16Ascii(buffer,0)],['UTF16-offset',utf16Ascii(buffer,1)]];for(const [encoding,text] of views)for(const [rule,pattern] of rules)if(pattern.test(text))record(encoding,rule);
  tail=Buffer.from(buffer.subarray(Math.max(0,buffer.length-overlap)));
 }}finally{fs.closeSync(fd);}
 return {file:path.basename(file),bytes:total,passed:hits.size===0,hits:[...hits.values()]};
}
export function scanPublication(targets){const files=[];const visit=target=>{const stat=fs.lstatSync(target);if(stat.isSymbolicLink())throw new Error('publication-symlink-not-allowed');if(stat.isDirectory()){for(const entry of fs.readdirSync(target))visit(path.join(target,entry));}else{if(/\.(zip|7z)$/i.test(target))throw new Error('publication-archive-requires-extracted-payload');files.push(target);}};targets.forEach(visit);return files.map(file=>scanPublicationFile(file));}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{const targets=process.argv.slice(2);if(!targets.length)throw new Error('publication-target-required');const reports=scanPublication(targets);console.log(JSON.stringify({passed:reports.every(r=>r.passed),files:reports.length,failures:reports.filter(r=>!r.passed)}));if(reports.some(r=>!r.passed))process.exitCode=1;}catch(error){console.error(error.message);process.exitCode=1;}}
