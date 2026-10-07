import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';import {createRequire} from 'node:module';
export function buildEnvironment({env=process.env,root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),home=os.homedir(),platform=process.platform}={}){
 const roots=[['profile',env.USERPROFILE??home],['cargo',env.CARGO_HOME??path.join(home,'.cargo')],['rustup',env.RUSTUP_HOME??path.join(home,'.rustup')],['target',env.CARGO_TARGET_DIR??path.join(root,'src-tauri','target')],['project',root]];
 const mappings=[];for(const [label,value] of roots){if(!value)continue;const absolute=path.resolve(value);for(const source of new Set([absolute,fs.existsSync(absolute)?fs.realpathSync(absolute):absolute]))mappings.push({label,source,destination:`/build/${label}`});}
 // rustc uses the last matching mapping. Put more specific prefixes after broad profile roots.
 mappings.sort((a,b)=>a.source.length-b.source.length);
 const flags=env.CARGO_ENCODED_RUSTFLAGS!==undefined?env.CARGO_ENCODED_RUSTFLAGS.split('\x1f').filter(Boolean):(env.RUSTFLAGS??'').split(/\s+/).filter(Boolean);
 for(const mapping of mappings)flags.push(`--remap-path-prefix=${mapping.source}=${mapping.destination}`);
 if(platform==='win32')flags.push('-C','link-arg=/PDBALTPATH:codex-control-center.pdb');
 return {env:{...env,CARGO_ENCODED_RUSTFLAGS:flags.join('\x1f')},mappings};
}
export function runBuild(args=process.argv.slice(2)){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),{env}=buildEnvironment({root});
 const require=createRequire(import.meta.url),cli=require.resolve('@tauri-apps/cli/tauri.js');
 const result=spawnSync(process.execPath,[cli,'build',...args],{cwd:root,env,stdio:'inherit',windowsHide:true});if(result.error)throw new Error('desktop-build-launch-failed');return result.status??1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=runBuild();
