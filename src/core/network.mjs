import http from 'node:http';import path from 'node:path';import {fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';
export function proxyEnvironment(env=process.env,system={}){
 const result={...env};if(env.NODE_USE_ENV_PROXY==='0')return result;
 result.NODE_USE_ENV_PROXY??='1';
 if(!['https_proxy','HTTPS_PROXY','http_proxy','HTTP_PROXY','all_proxy','ALL_PROXY'].some(k=>env[k])){
  const server=system.server;if(typeof server==='string'){
   const parts=server.split(';');for(const protocol of ['http','https']){const match=parts.find(p=>p.startsWith(protocol+'='));const raw=match?match.slice(protocol.length+1):parts.length===1?server:null;if(!raw)continue;const candidate=/^https?:\/\//i.test(raw)?raw:'http://'+raw;try{const url=new URL(candidate);if(['http:','https:'].includes(url.protocol)&&url.hostname&&!url.username&&!url.password)result[protocol.toUpperCase()+'_PROXY']=url.href;}catch{}}
   if(!env.NO_PROXY&&!env.no_proxy&&typeof system.bypass==='string')result.NO_PROXY=system.bypass.split(';').filter(v=>v&&v!=='<local>').join(',');
  }
 }
 return result;
}
export function configureNetwork(){
 if(process.env.NODE_USE_ENV_PROXY==='0')return;
 let system={};if(process.platform==='win32'&&!['https_proxy','HTTPS_PROXY','http_proxy','HTTP_PROXY'].some(k=>process.env[k])){try{system=JSON.parse(execFileSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('../../scripts/Read-SystemProxy.ps1',import.meta.url))],{windowsHide:true,encoding:'utf8',timeout:10000}));}catch{/* No configured usable system proxy: preserve direct networking. */}}
 const env=proxyEnvironment(process.env,system);for(const key of ['NODE_USE_ENV_PROXY','HTTP_PROXY','HTTPS_PROXY','NO_PROXY'])if(env[key]!==undefined&&process.env[key]===undefined)process.env[key]=env[key];
 http.setGlobalProxyFromEnv?.(process.env);
}
